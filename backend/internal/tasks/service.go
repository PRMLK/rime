package tasks

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrNotFound       = errors.New("scheduled task not found")
	ErrAlreadyRunning = errors.New("scheduled task is already running")
)

type Task struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Status         string     `json:"status"`
	LastRunAt      *time.Time `json:"lastRunAt,omitempty"`
	LastDurationMs *int64     `json:"lastDurationMs,omitempty"`
	LastSucceeded  *bool      `json:"lastSucceeded,omitempty"`
}

type Definition struct {
	ID   string
	Name string
	Run  func(context.Context) error
}

type Repository interface {
	EnsureScheduledTask(context.Context, string, string, int) error
	ListScheduledTasks(context.Context) ([]Task, error)
	RecordScheduledTaskRun(context.Context, string, time.Time, time.Duration, error) error
}

type Service struct {
	repo        Repository
	definitions map[string]Definition
	ctx         context.Context
	cancel      context.CancelFunc

	mu      sync.RWMutex
	running map[string]bool
	wg      sync.WaitGroup
}

func New(ctx context.Context, repo Repository, definitions ...Definition) (*Service, error) {
	serviceCtx, cancel := context.WithCancel(ctx)
	service := &Service{
		repo:        repo,
		definitions: make(map[string]Definition, len(definitions)),
		ctx:         serviceCtx,
		cancel:      cancel,
		running:     make(map[string]bool),
	}
	for position, definition := range definitions {
		if definition.ID == "" || definition.Name == "" || definition.Run == nil {
			cancel()
			return nil, errors.New("scheduled task definition is incomplete")
		}
		if _, exists := service.definitions[definition.ID]; exists {
			cancel()
			return nil, fmt.Errorf("duplicate scheduled task %q", definition.ID)
		}
		if err := repo.EnsureScheduledTask(ctx, definition.ID, definition.Name, position); err != nil {
			cancel()
			return nil, fmt.Errorf("register scheduled task %q: %w", definition.ID, err)
		}
		service.definitions[definition.ID] = definition
	}
	return service, nil
}

func (s *Service) Close() {
	s.cancel()
	s.wg.Wait()
}

func (s *Service) List(ctx context.Context) ([]Task, error) {
	tasks, err := s.repo.ListScheduledTasks(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for index := range tasks {
		if s.running[tasks[index].ID] {
			tasks[index].Status = "running"
		} else {
			tasks[index].Status = "idle"
		}
	}
	return tasks, nil
}

func (s *Service) RunNow(ctx context.Context, taskID string) (Task, error) {
	definition, exists := s.definitions[taskID]
	if !exists {
		return Task{}, ErrNotFound
	}
	task, err := s.find(ctx, taskID)
	if err != nil {
		return Task{}, err
	}

	s.mu.Lock()
	if s.running[taskID] {
		s.mu.Unlock()
		return Task{}, ErrAlreadyRunning
	}
	s.running[taskID] = true
	s.wg.Add(1)
	s.mu.Unlock()

	task.Status = "running"
	go s.run(definition)
	return task, nil
}

func (s *Service) find(ctx context.Context, taskID string) (Task, error) {
	tasks, err := s.repo.ListScheduledTasks(ctx)
	if err != nil {
		return Task{}, err
	}
	for _, task := range tasks {
		if task.ID == taskID {
			return task, nil
		}
	}
	return Task{}, ErrNotFound
}

func (s *Service) run(definition Definition) {
	defer s.wg.Done()
	started := time.Now().UTC()
	runErr := definition.Run(s.ctx)
	duration := time.Since(started)
	_ = s.repo.RecordScheduledTaskRun(context.WithoutCancel(s.ctx), definition.ID, started, duration, runErr)

	s.mu.Lock()
	delete(s.running, definition.ID)
	s.mu.Unlock()
}
