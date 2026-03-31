import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import type { BoardSummary } from "@nextplay/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

export default function BoardsHome() {
  const { signOut, user } = useAuth();
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const boardsQuery = useQuery({
    queryKey: ["boards"],
    queryFn: () => api.listBoards(),
  });

  const createBoard = useMutation({
    mutationFn: () => api.createBoard({ title: title.trim() || "Untitled board" }),
    onSuccess: () => {
      setTitle("");
      setTitleError(null);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["boards"] });
    },
  });

  const sortedBoards = useMemo(() => {
    const boards = (boardsQuery.data as BoardSummary[] | undefined) ?? [];
    return [...boards].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [boardsQuery.data]);
  const hasBoards = sortedBoards.length > 0;

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function onCreateBoard() {
    if (!title.trim()) {
      setTitleError("Board title is required.");
      return;
    }
    setTitleError(null);
    void createBoard.mutate();
  }

  const loading = boardsQuery.isLoading;
  const error = boardsQuery.isError;

  return (
    <div className="min-h-screen bg-[#0b0f14] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0b0f14]/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="text-sm font-semibold tracking-wide text-slate-100">NEXTPLAY</span>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300 sm:inline">
              {user?.email}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        <section className="mb-10 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-6 shadow-card sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-100">
                Your boards
              </h1>
              <p className="mt-2 max-w-xl text-sm text-slate-400">
                Create and manage your workspaces. Organize tasks visually with columns, drag-and-drop flow, and
                clear progress tracking.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14]"
            >
              New board
            </button>
          </div>
        </section>

        <section aria-live="polite">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Your boards
            </h2>
            {hasBoards ? (
              <span className="text-xs text-slate-500">{sortedBoards.length} total</span>
            ) : null}
          </div>

          {loading ? (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <li
                  key={`skeleton-${idx}`}
                  className="min-h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
                >
                  <div className="h-4 w-2/3 rounded bg-slate-800" />
                  <div className="mt-4 h-3 w-1/2 rounded bg-slate-800" />
                  <div className="mt-2 h-3 w-1/3 rounded bg-slate-800" />
                </li>
              ))}
            </ul>
          ) : error ? (
            <div className="rounded-2xl border border-red-900/50 bg-red-950/40 p-5">
              <p className="text-sm font-medium text-red-300">Could not load boards.</p>
              <p className="mt-1 text-xs text-red-400/90">
                Check API URL, auth token, and backend connectivity.
              </p>
              <button
                type="button"
                onClick={() => void boardsQuery.refetch()}
                className="mt-3 rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-900/30"
              >
                Retry
              </button>
            </div>
          ) : !hasBoards ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-10 text-center">
              <h3 className="text-lg font-semibold text-slate-100">No boards yet</h3>
              <p className="mt-2 max-w-md text-sm text-slate-400">
                Create your first board to start planning tasks and moving work across your workflow.
              </p>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14]"
              >
                Create first board
              </button>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sortedBoards.map((b) => (
                <li key={b.id}>
                  <Link
                    to={`/boards/${b.id}`}
                    className="group block min-h-28 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-900/70 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <h3 className="font-semibold text-slate-100 transition group-hover:text-white">
                      {b.title}
                    </h3>
                    <p className="mt-2 text-xs text-slate-500">
                      Updated {new Date(b.updatedAt).toLocaleString()}
                    </p>
                    <p className="mt-3 text-xs font-medium text-blue-300 opacity-0 transition group-hover:opacity-100">
                      Open board →
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {open ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Create board dialog"
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-slate-100">New board</h3>
              <form
                className="mt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  onCreateBoard();
                }}
              >
                <input
                  autoFocus
                  placeholder="Board title"
                  value={title}
                  aria-label="Board title"
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (titleError) {
                      setTitleError(null);
                    }
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-500 focus:border-transparent focus:ring-2"
                />
                {titleError ? <p className="mt-2 text-xs text-red-400">{titleError}</p> : null}
              </form>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cancel creating board"
                  className="rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={createBoard.isPending}
                  onClick={onCreateBoard}
                  aria-label="Create board"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {createBoard.isPending ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
