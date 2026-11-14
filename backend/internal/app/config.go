package app

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds runtime settings. AdminPassword is used only to initialize the first administrator.
type Config struct {
	Port          string
	DBPath        string
	WebDir        string
	AdminEmail    string
	AdminPassword string
	CookieSecure  bool
	DevOrigin     string
}

// ConfigFromEnv validates environment configuration without requiring a password on subsequent starts.
func ConfigFromEnv() (Config, error) {
	c := Config{
		Port: envDefault("PORT", "8080"), DBPath: envDefault("DB_PATH", "data/word.db"),
		WebDir: os.Getenv("WEB_DIR"), AdminEmail: envDefault("ADMIN_EMAIL", "admin@word.local"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"), DevOrigin: os.Getenv("DEV_ORIGIN"),
	}
	port, err := strconv.Atoi(c.Port)
	if err != nil || port < 1 || port > 65535 {
		return c, fmt.Errorf("PORT must be between 1 and 65535")
	}
	c.CookieSecure, err = strconv.ParseBool(envDefault("COOKIE_SECURE", "false"))
	if err != nil {
		return c, fmt.Errorf("COOKIE_SECURE must be a boolean")
	}
	if c.DevOrigin != "" {
		u, err := parseOrigin(c.DevOrigin)
		if err != nil || u.Scheme != "http" || u.Port() != "5173" || !isLoopbackHost(u.Hostname()) || c.CookieSecure {
			return c, fmt.Errorf("DEV_ORIGIN must be an HTTP localhost Vite origin on port 5173, with COOKIE_SECURE=false")
		}
		c.DevOrigin = u.String()
	}
	return c, nil
}

func envDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func parseOrigin(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, fmt.Errorf("invalid origin")
	}
	if strings.ContainsAny(u.Host, "\\ \t\r\n") {
		return nil, fmt.Errorf("invalid origin host")
	}
	return u, nil
}

func remoteIP(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err == nil {
		return host
	}
	return addr
}
