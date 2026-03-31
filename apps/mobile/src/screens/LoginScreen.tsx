import { supabase } from "@/lib/supabase";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { RootStackParamList } from "@/types";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen(_props: Props) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          Alert.alert("Sign in failed", error.message);
        }
        return;
      }
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        Alert.alert("Sign up failed", error.message);
        return;
      }
      Alert.alert("Check your inbox", "Confirm your email if required, then sign in.");
      setMode("signin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <View style={styles.center}>
        <Text style={styles.title}>NextPlay</Text>
        <Text style={styles.sub}>Kanban boards</Text>
        <View style={styles.toggle}>
          <TouchableOpacity
            onPress={() => setMode("signin")}
            style={[styles.toggleBtn, mode === "signin" && styles.toggleActive]}
          >
            <Text style={styles.toggleText}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode("signup")}
            style={[styles.toggleBtn, mode === "signup" && styles.toggleActive]}
          >
            <Text style={styles.toggleText}>Sign up</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity style={styles.primary} onPress={() => void submit()} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>{mode === "signin" ? "Sign in" : "Create account"}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700", color: "#0f172a", textAlign: "center" },
  sub: { marginTop: 4, color: "#64748b", textAlign: "center", marginBottom: 24 },
  toggle: { flexDirection: "row", backgroundColor: "#e2e8f0", borderRadius: 10, padding: 4, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8 },
  toggleActive: { backgroundColor: "#fff" },
  toggleText: { fontWeight: "600", color: "#334155" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  primary: {
    backgroundColor: "#4f46e5",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  link: { marginTop: 16, textAlign: "center", color: "#6366f1" },
});
