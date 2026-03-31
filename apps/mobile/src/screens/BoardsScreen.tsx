import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import type { BoardSummary } from "@nextplay/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { RootStackParamList } from "@/types";

type Props = NativeStackScreenProps<RootStackParamList, "Boards">;

export default function BoardsScreen({ navigation }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => void supabase.auth.signOut()}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const q = useQuery({
    queryKey: ["boards"],
    queryFn: () => api.listBoards(),
  });

  const create = useMutation({
    mutationFn: () => api.createBoard({ title: title.trim() || "Untitled board" }),
    onSuccess: () => {
      setTitle("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["boards"] });
    },
    onError: (e: Error) => Alert.alert("Could not create board", e.message),
  });

  if (q.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (q.isError) {
    return (
      <View style={styles.centered}>
        <Text>Failed to load boards.</Text>
      </View>
    );
  }

  const data = (q.data ?? []) as BoardSummary[];

  return (
    <View style={styles.flex}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Text style={styles.heading}>Your boards</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("Board", { boardId: item.id })}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>{new Date(item.updatedAt).toLocaleString()}</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setOpen(true)}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>

      {open ? (
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New board</Text>
            <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
            <View style={styles.row}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setOpen(false)}>
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPrimary} onPress={() => void create.mutate()} disabled={create.isPending}>
                <Text style={styles.btnPrimaryText}>{create.isPending ? "…" : "Create"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  signOut: { color: "#4f46e5", fontWeight: "600", marginRight: 4 },
  flex: { flex: 1, backgroundColor: "#f8fafc" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, paddingBottom: 96 },
  heading: { fontSize: 22, fontWeight: "700", color: "#0f172a", marginBottom: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  cardMeta: { marginTop: 4, fontSize: 12, color: "#64748b" },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#4f46e5",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  fabText: { color: "#fff", fontSize: 28, marginTop: -2 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  modal: { backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 14 },
  btnPrimary: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  btnPrimaryText: { color: "#fff", fontWeight: "700" },
});
