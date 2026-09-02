package lyrics

import (
	"encoding/xml"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

func Parse(format, content string) (Document, error) {
	switch strings.ToLower(format) {
	case "lrc":
		return parseLRC(content), nil
	case "ttml":
		return parseTTML(content)
	case "plain", "txt":
		return plainDocument(content), nil
	default:
		return Document{}, fmt.Errorf("unsupported lyrics format %q", format)
	}
}

func parseLRC(content string) Document {
	content = normalizeNewlines(content)
	offset := int64(0)
	lines := make([]Line, 0)
	plain := make([]string, 0)
	for _, rawLine := range strings.Split(content, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		if value, ok := metadataValue(line, "offset"); ok {
			offset, _ = strconv.ParseInt(strings.TrimSpace(value), 10, 64)
			continue
		}
		timestamps, text := lrcTimestamps(line)
		if len(timestamps) == 0 {
			if !isMetadataLine(line) {
				plain = append(plain, line)
			}
			continue
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		for _, start := range timestamps {
			start += offset
			if start < 0 {
				start = 0
			}
			startCopy := start
			lines = append(lines, Line{StartMs: &startCopy, Text: text})
		}
	}
	if len(lines) == 0 {
		return plainDocument(strings.Join(plain, "\n"))
	}
	sort.SliceStable(lines, func(i, j int) bool { return *lines[i].StartMs < *lines[j].StartMs })
	for index := 0; index+1 < len(lines); index++ {
		if *lines[index+1].StartMs > *lines[index].StartMs {
			end := *lines[index+1].StartMs
			lines[index].EndMs = &end
		}
	}
	return Document{Synced: true, Lines: lines}
}

func lrcTimestamps(line string) ([]int64, string) {
	result := make([]int64, 0, 1)
	position := 0
	for position < len(line) && line[position] == '[' {
		end := strings.IndexByte(line[position:], ']')
		if end < 0 {
			break
		}
		end += position
		value := line[position+1 : end]
		milliseconds, ok := parseLRCClock(value)
		if !ok {
			break
		}
		result = append(result, milliseconds)
		position = end + 1
	}
	return result, line[position:]
}

func parseLRCClock(value string) (int64, bool) {
	minutesText, secondsText, ok := strings.Cut(value, ":")
	if !ok {
		return 0, false
	}
	minutes, err := strconv.ParseInt(minutesText, 10, 64)
	if err != nil || minutes < 0 {
		return 0, false
	}
	seconds, err := strconv.ParseFloat(secondsText, 64)
	if err != nil || seconds < 0 || seconds >= 60 {
		return 0, false
	}
	return minutes*60_000 + int64(seconds*1000+0.5), true
}

func metadataValue(line, key string) (string, bool) {
	if !strings.HasPrefix(line, "[") || !strings.HasSuffix(line, "]") {
		return "", false
	}
	name, value, ok := strings.Cut(line[1:len(line)-1], ":")
	return value, ok && strings.EqualFold(strings.TrimSpace(name), key)
}

func isMetadataLine(line string) bool {
	if !strings.HasPrefix(line, "[") || !strings.HasSuffix(line, "]") {
		return false
	}
	name, _, ok := strings.Cut(line[1:len(line)-1], ":")
	if !ok {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "ar", "al", "ti", "au", "by", "re", "ve", "length", "offset":
		return true
	default:
		return false
	}
}

func plainDocument(content string) Document {
	lines := make([]Line, 0)
	for _, rawLine := range strings.Split(normalizeNewlines(content), "\n") {
		if text := strings.TrimSpace(rawLine); text != "" {
			lines = append(lines, Line{Text: text})
		}
	}
	return Document{Lines: lines}
}

func parseTTML(content string) (Document, error) {
	decoder := xml.NewDecoder(strings.NewReader(content))
	lines := make([]Line, 0)
	var current *ttmlLine
	for {
		token, err := decoder.Token()
		if err != nil {
			if err == io.EOF {
				break
			}
			return Document{}, fmt.Errorf("parse TTML: %w", err)
		}
		switch typed := token.(type) {
		case xml.StartElement:
			if typed.Name.Local == "p" {
				current = &ttmlLine{}
				for _, attribute := range typed.Attr {
					switch attribute.Name.Local {
					case "begin":
						current.begin = attribute.Value
					case "end":
						current.end = attribute.Value
					}
				}
			}
		case xml.CharData:
			if current != nil {
				current.text.Write([]byte(typed))
			}
		case xml.EndElement:
			if typed.Name.Local == "p" && current != nil {
				text := strings.TrimSpace(strings.Join(strings.Fields(current.text.String()), " "))
				start, startOK := parseTTMLClock(current.begin)
				if text != "" && startOK {
					startCopy := start
					line := Line{StartMs: &startCopy, Text: text}
					if end, ok := parseTTMLClock(current.end); ok && end > start {
						endCopy := end
						line.EndMs = &endCopy
					}
					lines = append(lines, line)
				}
				current = nil
			}
		}
	}
	if len(lines) == 0 {
		return Document{}, fmt.Errorf("ttml contains no timed lyric lines")
	}
	sort.SliceStable(lines, func(i, j int) bool { return *lines[i].StartMs < *lines[j].StartMs })
	return Document{Synced: true, Lines: lines}, nil
}

type ttmlLine struct {
	begin string
	end   string
	text  strings.Builder
}

func parseTTMLClock(value string) (int64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if strings.HasSuffix(value, "ms") {
		milliseconds, err := strconv.ParseFloat(strings.TrimSuffix(value, "ms"), 64)
		return int64(milliseconds + 0.5), err == nil && milliseconds >= 0
	}
	if strings.HasSuffix(value, "s") {
		seconds, err := strconv.ParseFloat(strings.TrimSuffix(value, "s"), 64)
		return int64(seconds*1000 + 0.5), err == nil && seconds >= 0
	}
	parts := strings.Split(value, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, false
	}
	seconds, err := strconv.ParseFloat(parts[len(parts)-1], 64)
	if err != nil || seconds < 0 || seconds >= 60 {
		return 0, false
	}
	minutes, err := strconv.ParseInt(parts[len(parts)-2], 10, 64)
	if err != nil || minutes < 0 {
		return 0, false
	}
	hours := int64(0)
	if len(parts) == 3 {
		hours, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil || hours < 0 {
			return 0, false
		}
	}
	return hours*3_600_000 + minutes*60_000 + int64(seconds*1000+0.5), true
}

func normalizeNewlines(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n")
}
