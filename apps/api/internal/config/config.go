package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL      string
	SupabaseJWTSecret string
	HTTPAddr         string
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	db := os.Getenv("DATABASE_URL")
	if db == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	secret := os.Getenv("SUPABASE_JWT_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("SUPABASE_JWT_SECRET is required")
	}
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	return &Config{
		DatabaseURL:       db,
		SupabaseJWTSecret: secret,
		HTTPAddr:          addr,
	}, nil
}
