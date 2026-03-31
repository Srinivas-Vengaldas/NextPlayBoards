package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nextplay/api/internal/config"
	"github.com/nextplay/api/internal/handlers"
	appmiddleware "github.com/nextplay/api/internal/middleware"
)

func originList() []string {
	raw := os.Getenv("CORS_ORIGINS")
	if raw == "" {
		return []string{"*"}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{"*"}
	}
	return out
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatal("db ping:", err)
	}

	h := &handlers.Handlers{Pool: pool}
	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(60 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   originList(),
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/health", h.Health)

	r.Group(func(r chi.Router) {
		r.Use(appmiddleware.JWT(cfg.SupabaseJWTSecret))
		r.Get("/boards", h.ListBoards)
		r.Post("/boards", h.CreateBoard)
		r.Get("/boards/{id}", h.GetBoard)
		r.Get("/boards/{id}/members", h.ListBoardMembers)
		r.Get("/boards/{id}/member-search", h.SearchBoardMembers)
		r.Post("/boards/{id}/members", h.AddBoardMember)
		r.Get("/boards/{id}/team-members", h.ListTeamMembers)
		r.Post("/boards/{id}/team-members", h.CreateTeamMember)
		r.Get("/boards/{id}/labels", h.ListBoardLabels)
		r.Post("/boards/{id}/labels", h.CreateBoardLabel)
		r.Post("/boards/{id}/columns", h.CreateColumn)
		r.Patch("/columns/{id}", h.PatchColumn)
		r.Post("/columns/{id}/tasks", h.CreateTask)
		r.Patch("/tasks/{id}", h.PatchTask)
		r.Get("/tasks/{id}/comments", h.ListTaskComments)
		r.Post("/tasks/{id}/comments", h.CreateTaskComment)
		r.Get("/tasks/{id}/activity", h.ListTaskActivity)
		r.Get("/tasks/{id}/assignees", h.ListTaskAssignees)
		r.Post("/tasks/{id}/team-members", h.AddTaskTeamMember)
		r.Post("/tasks/{id}/labels", h.AddTaskLabel)
		r.Delete("/tasks/{taskId}/labels/{labelId}", h.RemoveTaskLabel)
		r.Post("/tasks/{id}/assignees", h.AddTaskAssignee)
		r.Delete("/tasks/{taskId}/assignees/{userId}", h.RemoveTaskAssignee)
		r.Delete("/tasks/{taskId}/team-members/{memberId}", h.RemoveTaskTeamMember)
	})

	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: r}
	go func() {
		log.Printf("listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
