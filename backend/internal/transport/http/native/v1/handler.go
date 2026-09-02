package v1

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"rime/backend/internal/artwork"
	"rime/backend/internal/browse"
	"rime/backend/internal/lyrics"
	"rime/backend/internal/playback"
	"rime/backend/internal/search"
	"rime/backend/internal/tasks"
)

type Handler struct {
	search   *search.Service
	browse   *browse.Service
	lyrics   *lyrics.Service
	playback *playback.Service
	artwork  *artwork.Service
	tasks    *tasks.Service
	logger   *slog.Logger
}

func New(searchService *search.Service, browseService *browse.Service, lyricsService *lyrics.Service, playbackService *playback.Service, artworkService *artwork.Service, taskService *tasks.Service, logger *slog.Logger) http.Handler {
	handler := &Handler{search: searchService, browse: browseService, lyrics: lyricsService, playback: playbackService, artwork: artworkService, tasks: taskService, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/system/info", handler.systemInfo)
	mux.HandleFunc("GET /api/v1/system/tasks", handler.listTasks)
	mux.HandleFunc("POST /api/v1/system/tasks/{taskID}/runs", handler.runTask)
	mux.HandleFunc("GET /api/v1/search", handler.searchTracks)
	mux.HandleFunc("GET /api/v1/albums/recent", handler.recentAlbums)
	mux.HandleFunc("GET /api/v1/tracks/{trackID}/lyrics", handler.trackLyrics)
	mux.HandleFunc("POST /api/v1/playback/sessions", handler.createPlaybackSession)
	mux.HandleFunc("GET /api/v1/playback/sessions/{sessionID}/stream", handler.stream)
	mux.HandleFunc("HEAD /api/v1/playback/sessions/{sessionID}/stream", handler.stream)
	mux.HandleFunc("POST /api/v1/playback/sessions/{sessionID}/events", handler.recordPlaybackEvent)
	mux.HandleFunc("DELETE /api/v1/playback/sessions/{sessionID}", handler.deletePlaybackSession)
	mux.HandleFunc("GET /api/v1/artworks/{artworkID}", handler.serveArtwork)
	mux.HandleFunc("HEAD /api/v1/artworks/{artworkID}", handler.serveArtwork)
	mux.HandleFunc("GET /healthz", handler.health)
	return requestMiddleware(logger, mux)
}

func (h *Handler) serveArtwork(w http.ResponseWriter, r *http.Request) {
	size, err := optionalInt(r.URL.Query().Get("size"))
	if err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_artwork_size", "Invalid artwork size", "Artwork size must be an integer.")
		return
	}
	resource, err := h.artwork.Open(r.Context(), r.PathValue("artworkID"), size)
	if err != nil {
		switch {
		case errors.Is(err, artwork.ErrInvalidSize):
			writeProblem(w, r, http.StatusBadRequest, "invalid_artwork_size", "Invalid artwork size", "Supported sizes are 128, 256, 512, and 1024 pixels.")
		case errors.Is(err, artwork.ErrNotFound):
			writeProblem(w, r, http.StatusNotFound, "artwork_not_found", "Artwork not found", "The artwork is missing or its cache must be rebuilt.")
		default:
			h.logger.Error("serve artwork", "artwork_id", r.PathValue("artworkID"), "error", err)
			writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The artwork could not be loaded.")
		}
		return
	}
	defer resource.File.Close()
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", resource.ContentType)
	w.Header().Set("ETag", fmt.Sprintf("\"%s-%d\"", r.PathValue("artworkID"), size))
	http.ServeContent(w, r, resource.Name, resource.ModifiedAt, resource.File)
}

func (h *Handler) systemInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":       "Rime",
		"apiVersion": "v1",
		"capabilities": []string{
			"search.tracks.v1",
			"browse.recent-albums.v1",
			"lyrics.timed.v1",
			"playback.direct.v1",
			"playback.events.v1",
			"system.tasks.v1",
		},
	})
}

func (h *Handler) trackLyrics(w http.ResponseWriter, r *http.Request) {
	document, err := h.lyrics.Get(r.Context(), r.PathValue("trackID"))
	if err != nil {
		if errors.Is(err, lyrics.ErrNotFound) {
			writeProblem(w, r, http.StatusNotFound, "lyrics_not_found", "Lyrics not found", "No lyrics are available for this track.")
			return
		}
		h.logger.Error("get track lyrics", "track_id", r.PathValue("trackID"), "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The lyrics could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, document)
}

func (h *Handler) recentAlbums(w http.ResponseWriter, r *http.Request) {
	limit, err := optionalInt(r.URL.Query().Get("limit"))
	if err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_limit", "Invalid limit", "Limit must be an integer.")
		return
	}
	page, err := h.browse.RecentAlbums(r.Context(), limit)
	if err != nil {
		if errors.Is(err, browse.ErrInvalidLimit) {
			writeProblem(w, r, http.StatusBadRequest, "invalid_limit", "Invalid limit", err.Error())
			return
		}
		h.logger.Error("list recent albums", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "Recent albums could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *Handler) listTasks(w http.ResponseWriter, r *http.Request) {
	items, err := h.tasks.List(r.Context())
	if err != nil {
		h.logger.Error("list scheduled tasks", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The scheduled tasks could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) runTask(w http.ResponseWriter, r *http.Request) {
	task, err := h.tasks.RunNow(r.Context(), r.PathValue("taskID"))
	if err != nil {
		switch {
		case errors.Is(err, tasks.ErrNotFound):
			writeProblem(w, r, http.StatusNotFound, "scheduled_task_not_found", "Scheduled task not found", "The requested scheduled task does not exist.")
		case errors.Is(err, tasks.ErrAlreadyRunning):
			writeProblem(w, r, http.StatusConflict, "scheduled_task_running", "Scheduled task is running", "The requested scheduled task is already running.")
		default:
			h.logger.Error("run scheduled task", "task_id", r.PathValue("taskID"), "error", err)
			writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The scheduled task could not be started.")
		}
		return
	}
	writeJSON(w, http.StatusAccepted, task)
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) searchTracks(w http.ResponseWriter, r *http.Request) {
	limit, err := optionalInt(r.URL.Query().Get("limit"))
	if err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_limit", "Invalid limit", err.Error())
		return
	}
	page, err := h.search.Tracks(r.Context(), r.URL.Query().Get("query"), limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_search", "Invalid search", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *Handler) createPlaybackSession(w http.ResponseWriter, r *http.Request) {
	var request playback.CreateRequest
	if err := decodeJSON(r, &request); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	session, err := h.playback.Create(r.Context(), request)
	if err != nil {
		switch {
		case errors.Is(err, playback.ErrTrackNotFound):
			writeProblem(w, r, http.StatusNotFound, "track_not_found", "Track not found", "The requested track is unavailable.")
		case errors.Is(err, playback.ErrUnsupportedFormat):
			writeProblem(w, r, http.StatusConflict, "playback_format_unsupported", "Playback format unsupported", "No direct-play source matches this player.")
		default:
			h.logger.Error("create playback session", "error", err)
			writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The playback session could not be created.")
		}
		return
	}
	w.Header().Set("Location", "/api/v1/playback/sessions/"+session.SessionID)
	writeJSON(w, http.StatusCreated, session)
}

func (h *Handler) stream(w http.ResponseWriter, r *http.Request) {
	track, mediaFile, err := h.playback.Stream(r.Context(), r.PathValue("sessionID"))
	if err != nil {
		if errors.Is(err, playback.ErrSessionNotFound) {
			writeProblem(w, r, http.StatusNotFound, "session_not_found", "Playback session not found", "The playback session is missing or expired.")
			return
		}
		h.logger.Error("resolve playback stream", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The media source could not be resolved.")
		return
	}
	file, err := os.Open(mediaFile.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeProblem(w, r, http.StatusGone, "media_missing", "Media missing", "The indexed media file is no longer available.")
			return
		}
		h.logger.Error("open media stream", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The media file could not be opened.")
		return
	}
	defer file.Close()

	name := safeFilename(track.Title, filepath.Ext(mediaFile.Path))
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
	w.Header().Set("Content-Type", mediaFile.ContentType)
	w.Header().Set("ETag", fmt.Sprintf("\"%s\"", mediaFile.ContentVersion))
	http.ServeContent(w, r, name, time.UnixMilli(mediaFile.ModifiedUnixMs), file)
}

func (h *Handler) recordPlaybackEvent(w http.ResponseWriter, r *http.Request) {
	var event playback.Event
	if err := decodeJSON(r, &event); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", err.Error())
		return
	}
	if err := h.playback.Record(r.Context(), r.PathValue("sessionID"), event); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid_playback_event", "Invalid playback event", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) deletePlaybackSession(w http.ResponseWriter, r *http.Request) {
	if err := h.playback.Delete(r.Context(), r.PathValue("sessionID")); err != nil {
		h.logger.Error("delete playback session", "error", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal_error", "Internal error", "The playback session could not be deleted.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type problem struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail"`
	Instance string `json:"instance"`
	Code     string `json:"code"`
	TraceID  string `json:"traceId,omitempty"`
}

func writeProblem(w http.ResponseWriter, r *http.Request, status int, code, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(problem{
		Type:     "about:blank",
		Title:    title,
		Status:   status,
		Detail:   detail,
		Instance: r.URL.Path,
		Code:     code,
		TraceID:  w.Header().Get("X-Request-ID"),
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("request body must contain one JSON value")
	}
	return nil
}

func optionalInt(value string) (int, error) {
	if value == "" {
		return 0, nil
	}
	return strconv.Atoi(value)
}

func safeFilename(title, extension string) string {
	replacer := strings.NewReplacer("/", "_", "\\", "_", "\r", "", "\n", "")
	return replacer.Replace(title) + extension
}

func requestMiddleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = strconv.FormatInt(started.UnixNano(), 36)
		}
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("Rime-API-Version", "v1")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
		logger.Debug("http request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(started), "request_id", requestID)
	})
}
