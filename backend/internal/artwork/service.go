package artwork

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"os"
	"path/filepath"
	"sync"
	"time"

	xdraw "golang.org/x/image/draw"
)

var (
	ErrNotFound    = errors.New("artwork not found")
	ErrInvalidSize = errors.New("invalid artwork size")
)

type Repository interface {
	GetArtwork(context.Context, string) (Asset, error)
}

type Resource struct {
	File        *os.File
	ContentType string
	Name        string
	ModifiedAt  time.Time
}

type Service struct {
	repo  Repository
	cache *Cache
	mu    sync.Mutex
}

func NewService(repo Repository, cache *Cache) *Service {
	return &Service{repo: repo, cache: cache}
}

func (s *Service) Open(ctx context.Context, artworkID string, size int) (Resource, error) {
	if size != 0 && size != 128 && size != 256 && size != 512 && size != 1024 {
		return Resource{}, ErrInvalidSize
	}
	asset, err := s.repo.GetArtwork(ctx, artworkID)
	if err != nil {
		return Resource{}, err
	}
	if size == 0 || (asset.Width <= size && asset.Height <= size) {
		path, err := s.cache.OriginalPath(asset)
		if err != nil {
			return Resource{}, err
		}
		return openResource(path, asset.ContentType)
	}

	path, err := s.cache.ThumbnailPath(asset, size)
	if err != nil {
		return Resource{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := s.generateThumbnail(asset, path, size); err != nil {
			return Resource{}, err
		}
	} else if err != nil {
		return Resource{}, err
	}
	return openResource(path, "image/jpeg")
}

func (s *Service) generateThumbnail(asset Asset, destination string, size int) error {
	sourcePath, err := s.cache.OriginalPath(asset)
	if err != nil {
		return err
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	decoded, _, err := image.Decode(source)
	source.Close()
	if err != nil {
		return fmt.Errorf("decode artwork: %w", err)
	}
	width, height := fit(decoded.Bounds().Dx(), decoded.Bounds().Dy(), size)
	target := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(target, target.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	xdraw.CatmullRom.Scale(target, target.Bounds(), decoded, decoded.Bounds(), draw.Over, nil)

	if err := os.MkdirAll(filepath.Dir(destination), 0o750); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(destination), ".thumbnail-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if err := jpeg.Encode(temporary, target, &jpeg.Options{Quality: 88}); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, destination)
}

func openResource(path, contentType string) (Resource, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return Resource{}, ErrNotFound
	}
	if err != nil {
		return Resource{}, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return Resource{}, err
	}
	return Resource{File: file, ContentType: contentType, Name: filepath.Base(path), ModifiedAt: info.ModTime()}, nil
}

func fit(width, height, maximum int) (int, int) {
	if width >= height {
		return maximum, max(1, height*maximum/width)
	}
	return max(1, width*maximum/height), maximum
}
