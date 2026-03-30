import AsyncStorage from "@react-native-async-storage/async-storage"
import { Stack, useRouter } from "expo-router"
import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { AuthProvider } from "./auth-context"

export default function RootLayout() {
  const router = useRouter()
  const [resetKey, setResetKey] = useState("auth")
  const [resetting, setResetting] = useState(false)

  const handleReset = async () => {
    if (resetting) return

    setResetting(true)
    await AsyncStorage.clear()
    setResetKey(String(Date.now()))
    router.dismissAll()
    router.replace("/")
    setResetting(false)
  }

  return (
    <AuthProvider key={resetKey}>
      <View style={styles.container}>
        <Stack
          screenOptions={{
            headerBackTitle: "Back",
          }}
        >
          <Stack.Screen name="index" options={{ title: "Pilot Test App" }} />
          <Stack.Screen name="login" options={{ title: "Login Form" }} />
          <Stack.Screen name="profile" options={{ title: "Profile" }} />
          <Stack.Screen name="list" options={{ title: "List" }} />
          <Stack.Screen name="toggles" options={{ title: "Toggles" }} />
          <Stack.Screen name="spinner" options={{ title: "Spinner" }} />
          <Stack.Screen
            name="gestures"
            options={{
              title: "Gestures",
              gestureEnabled: false,
            }}
          />
          <Stack.Screen name="dialogs" options={{ title: "Dialogs" }} />
          <Stack.Screen name="visibility" options={{ title: "Visibility" }} />
          <Stack.Screen name="accessibility" options={{ title: "Accessibility" }} />
          <Stack.Screen name="permissions" options={{ title: "Permissions" }} />
          <Stack.Screen name="clipboard" options={{ title: "Clipboard" }} />
          <Stack.Screen name="slow-load" options={{ title: "Slow Load" }} />
          <Stack.Screen name="scroll" options={{ title: "Scroll" }} />
          <Stack.Screen name="api-calls" options={{ title: "API Calls" }} />
        </Stack>
        <Pressable
          onPress={() => {
            void handleReset()
          }}
          style={[styles.resetButton, resetting ? styles.resetButtonDisabled : null]}
          accessibilityRole="button"
          accessibilityLabel="Pilot Reset"
          disabled={resetting}
        >
          <Text style={styles.resetButtonText}>{resetting ? "…" : "R"}</Text>
        </Pressable>
      </View>
    </AuthProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  resetButton: {
    position: "absolute",
    top: 56,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  resetButtonDisabled: {
    opacity: 0.6,
  },
  resetButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
})
