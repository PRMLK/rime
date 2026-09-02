package artwork

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"go.senan.xyz/taglib"
	_ "golang.org/x/image/webp"
)

const maxSourceBytes = 32 << 20

type Asset struct {
	ID          string
	ContentHash string
	ContentType string
	Extension   string
	StorageKey  string
	SourceKind  string
	SourcePath  string
	Size        int64
	Width       int
	Height      int
}

type Cache struct {
	root      string
	musicRoot string
}

func NewCache(root, musicRoot string) (*Cache, error) {
	root, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return nil, fmt.Errorf("resolve artwork cache: %w", err)
	}
	musicRoot, err = filepath.Abs(filepath.Clean(musicRoot))
	if err != nil {
		return nil, fmt.Errorf("resolve music root: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "original"), 0o750); err != nil {
		return nil, fmt.Errorf("create artwork cache: %w", err)
	}
	return &Cache{root: root, musicRoot: musicRoot}, nil
}

func (c *Cache) Resolve(audioPath string, hasEmbedded bool) (*Asset, error) {
	var embeddedErr error
	if hasEmbedded {
		data, err := taglib.ReadImage(audioPath)
		if err == nil && len(data) > 0 {
			return c.store(data, "embedded", audioPath+"#embedded:0")
		}
		embeddedErr = err
	}

	sidecar, err := c.findSidecar(audioPath)
	if err != nil {
		return nil, err
	}
	if sidecar == "" {
		return nil, embeddedErr
	}
	file, err := os.Open(sidecar)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSourceBytes+1))
	if err != nil {
		return nil, err
	}
	return c.store(data, "sidecar", sidecar)
}

func (c *Cache) OriginalPath(asset Asset) (string, error) {
	return c.storagePath(asset.StorageKey)
}

func (c *Cache) ThumbnailPath(asset Asset, size int) (string, error) {
	return c.storagePath(filepath.Join(strconv.Itoa(size), asset.ContentHash+".jpg"))
}

func (c *Cache) storagePath(key string) (string, error) {
	path := filepath.Join(c.root, filepath.FromSlash(key))
	relative, err := filepath.Rel(c.root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid artwork storage key")
	}
	return path, nil
}

func (c *Cache) store(data []byte, sourceKind, sourcePath string) (*Asset, error) {
	if len(data) == 0 {
		return nil, nil
	}
	if len(data) > maxSourceBytes {
		return nil, fmt.Errorf("artwork exceeds %d bytes", maxSourceBytes)
	}
	contentType, extension, err := imageType(data)
	if err != nil {
		return nil, err
	}
	configuration, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode artwork metadata: %w", err)
	}
	if configuration.Width <= 0 || configuration.Height <= 0 || int64(configuration.Width)*int64(configuration.Height) > 80_000_000 {
		return nil, fmt.Errorf("artwork dimensions are invalid or too large")
	}

	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	asset := &Asset{
		ID:          "aw_" + digest,
		ContentHash: digest,
		ContentType: contentType,
		Extension:   extension,
		StorageKey:  filepath.ToSlash(filepath.Join("original", digest+extension)),
		SourceKind:  sourceKind,
		SourcePath:  sourcePath,
		Size:        int64(len(data)),
		Width:       configuration.Width,
		Height:      configuration.Height,
	}
	path, err := c.OriginalPath(*asset)
	if err != nil {
		return nil, err
	}
	if err := writeAtomic(path, data); err != nil {
		return nil, fmt.Errorf("cache artwork: %w", err)
	}
	return asset, nil
}

func (c *Cache) findSidecar(audioPath string) (string, error) {
	directory := filepath.Dir(audioPath)
	path, err := sidecarIn(directory)
	if err != nil || path != "" {
		return path, err
	}
	if isDiscDirectory(filepath.Base(directory)) {
		parent := filepath.Dir(directory)
		if c.contains(parent) {
			return sidecarIn(parent)
		}
	}
	return "", nil
}

func (c *Cache) contains(path string) bool {
	relative, err := filepath.Rel(c.musicRoot, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func sidecarIn(directory string) (string, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return "", err
	}
	byName := make(map[string]os.DirEntry, len(entries))
	for _, entry := range entries {
		byName[strings.ToLower(entry.Name())] = entry
	}
	for _, base := range []string{"cover", "folder", "front"} {
		for _, extension := range []string{".jpg", ".jpeg", ".png", ".webp"} {
			entry := byName[base+extension]
			if entry == nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				continue
			}
			return filepath.Join(directory, entry.Name()), nil
		}
	}
	return "", nil
}

func isDiscDirectory(name string) bool {
	normalized := strings.NewReplacer(" ", "", "-", "", "_", "").Replace(strings.ToLower(name))
	for _, prefix := range []string{"disc", "disk", "cd"} {
		if suffix, ok := strings.CutPrefix(normalized, prefix); ok {
			_, err := strconv.Atoi(suffix)
			return suffix != "" && err == nil
		}
	}
	return false
}

func imageType(data []byte) (string, string, error) {
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(http.DetectContentType(data), ";", 2)[0]))
	switch contentType {
	case "image/jpeg":
		return contentType, ".jpg", nil
	case "image/png":
		return contentType, ".png", nil
	case "image/gif":
		return contentType, ".gif", nil
	case "image/webp":
		return contentType, ".webp", nil
	default:
		return "", "", fmt.Errorf("unsupported artwork type %q", contentType)
	}
}

func writeAtomic(path string, data []byte) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".artwork-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}
