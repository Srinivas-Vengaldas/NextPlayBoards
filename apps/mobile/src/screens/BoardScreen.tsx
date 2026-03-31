import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import type { BoardDetail, Column, Task } from "@nextplay/shared";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DraggableFlatList, { type RenderItemParams, ScaleDecorator } from "react-native-draggable-flatlist";
import type { RootStackParamList } from "@/types";

type Props = NativeStackScreenProps<RootStackParamList, "Board">;

function sortedColumns(board: BoardDetail): Column[] {
  return [...board.columns].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

function positionForIndex(list: Task[], index: number): number {
  const prev = index > 0 ? list[index - 1] : undefined;
  const next = index < list.length - 1 ? list[index + 1] : undefined;
  if (!prev && !next) {
    return 1000;
  }
  if (!prev && next) {
    return next.position - 500;
  }
  if (prev && !next) {
    return prev.position + 1000;
  }
  if (prev && next) {
    return (prev.position + next.position) / 2;
  }
  return 1000;
}

export default function BoardScreen({ route, navigation }: Props) {
  const { boardId } = route.params;
  const q = useQuery({
    queryKey: ["board", boardId],
    queryFn: () => api.getBoard(boardId),
  });

  const patchTask = useMutation({
    mutationFn: (args: { taskId: string; body: Parameters<typeof api.patchTask>[1] }) =>
      api.patchTask(args.taskId, args.body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["board", boardId] }),
  });

  const board = q.data;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: board?.title ?? "Board",
    });
  }, [board?.title, navigation]);

  if (q.isLoading || !board) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (q.isError) {
    return (
      <View style={styles.centered}>
        <Text>Could not load board.</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView horizontal contentContainerStyle={styles.rowScroll}>
        {sortedColumns(board).map((col) => (
          <ColumnCard
            key={col.id}
            board={board}
            column={col}
            boardId={boardId}
            onPersistOrder={(ordered) => {
              for (let i = 0; i < ordered.length; i++) {
                const t = ordered[i];
                const orig = col.tasks.find((x) => x.id === t.id);
                const pos = positionForIndex(ordered, i);
                if (orig && Math.abs(orig.position - pos) > 1e-6) {
                  patchTask.mutate({ taskId: t.id, body: { columnId: col.id, position: pos } });
                }
              }
            }}
            onMoveTask={(task) => {
              const others = sortedColumns(board).filter((c) => c.id !== col.id);
              Alert.alert(
                "Move task",
                task.title,
                [
                  ...others.map((c) => ({
                    text: c.title,
                    onPress: () => {
                      const sortedTarget = sortTasks(c.tasks);
                      const last = sortedTarget[sortedTarget.length - 1];
                      const pos = last ? last.position + 1000 : 1000;
                      void patchTask.mutateAsync({
                        taskId: task.id,
                        body: { columnId: c.id, position: pos },
                      });
                    },
                  })),
                  { text: "Cancel", style: "cancel" },
                ],
                { cancelable: true }
              );
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function ColumnCard({
  column,
  board: _board,
  boardId,
  onPersistOrder,
  onMoveTask,
}: {
  column: Column;
  board: BoardDetail;
  boardId: string;
  onPersistOrder: (tasks: Task[]) => void;
  onMoveTask: (task: Task) => void;
}) {
  const [data, setData] = useState<Task[]>(() => sortTasks(column.tasks));

  useEffect(() => {
    setData(sortTasks(column.tasks));
  }, [column.tasks]);

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<Task>) => (
      <ScaleDecorator>
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={drag}
          disabled={isActive}
          style={[styles.task, isActive && styles.taskActive]}
        >
          <Text style={styles.taskTitle}>{item.title}</Text>
          {item.description ? <Text style={styles.taskDesc}>{item.description}</Text> : null}
          <TouchableOpacity onPress={() => onMoveTask(item)} style={styles.moveBtn}>
            <Text style={styles.moveBtnText}>Move to…</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </ScaleDecorator>
    ),
    [onMoveTask]
  );

  return (
    <View style={styles.column}>
      <Text style={styles.colTitle}>{column.title}</Text>
      <Text style={styles.colMeta}>{data.length} tasks</Text>
      <View style={styles.listWrap}>
        <DraggableFlatList
          data={data}
          keyExtractor={(item) => item.id}
          onDragEnd={({ data: next }) => {
            setData(next);
            onPersistOrder(next);
          }}
          renderItem={renderItem}
          containerStyle={styles.draggableContainer}
        />
      </View>
      <QuickAdd columnId={column.id} boardId={boardId} />
    </View>
  );
}

function QuickAdd({ columnId, boardId }: { columnId: string; boardId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () => api.createTask(columnId, { title: title.trim() || "Untitled" }),
    onSuccess: () => {
      setTitle("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["board", boardId] });
    },
  });

  if (!open) {
    return (
      <TouchableOpacity style={styles.addBtn} onPress={() => setOpen(true)}>
        <Text style={styles.addBtnText}>＋ Add task</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.addForm}>
      <TextInput
        style={styles.input}
        placeholder="Task title"
        value={title}
        onChangeText={setTitle}
      />
      <View style={styles.addRow}>
        <TouchableOpacity onPress={() => setOpen(false)}>
          <Text>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnPrimarySm} onPress={() => void add.mutate()}>
          <Text style={styles.btnPrimarySmText}>Add</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f1f5f9" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  rowScroll: { padding: 12, alignItems: "flex-start", gap: 12 },
  column: {
    width: 280,
    backgroundColor: "#e2e8f0",
    borderRadius: 16,
    padding: 10,
    maxHeight: "100%",
  },
  colTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  colMeta: { fontSize: 11, color: "#64748b", marginBottom: 8, textTransform: "uppercase" },
  listWrap: { flexGrow: 1, minHeight: 120 },
  draggableContainer: { flexGrow: 1 },
  task: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  taskActive: { opacity: 0.85 },
  taskTitle: { fontSize: 14, fontWeight: "600", color: "#0f172a" },
  taskDesc: { marginTop: 4, fontSize: 12, color: "#64748b" },
  moveBtn: { marginTop: 8, alignSelf: "flex-start" },
  moveBtnText: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  addBtn: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#94a3b8",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  addBtnText: { fontSize: 12, color: "#475569", fontWeight: "600" },
  addForm: { marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  addRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  btnPrimarySm: {
    backgroundColor: "#4f46e5",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  btnPrimarySmText: { color: "#fff", fontWeight: "700", fontSize: 12 },
});
