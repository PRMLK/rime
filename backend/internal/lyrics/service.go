package lyrics

import "context"

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Get(ctx context.Context, trackID string) (Document, error) {
	source, err := s.repo.GetLyricsSource(ctx, trackID)
	if err != nil {
		return Document{}, err
	}
	document, err := Parse(source.Format, source.Content)
	if err != nil {
		return Document{}, err
	}
	document.TrackID = source.TrackID
	document.Source = source.Kind
	return document, nil
}
