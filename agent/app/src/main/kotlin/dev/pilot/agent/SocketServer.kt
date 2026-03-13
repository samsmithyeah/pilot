package dev.pilot.agent

import android.util.Log
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException

/**
 * TCP socket server that listens for JSON commands from the host daemon.
 *
 * Protocol: newline-delimited JSON. Each line is a complete JSON object.
 * Request:  {"id": "uuid", "method": "methodName", "params": {...}}
 * Response: {"id": "uuid", "result": {...}} or {"id": "uuid", "error": {...}}
 */
class SocketServer(
    private val port: Int,
    private val commandHandler: CommandHandler
) {
    companion object {
        private const val TAG = "PilotSocket"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var serverSocket: ServerSocket? = null

    @Volatile
    private var running = false

    suspend fun start() {
        running = true
        try {
            serverSocket = ServerSocket(port)
            Log.i(TAG, "Listening on port $port")

            while (running) {
                val client = try {
                    serverSocket?.accept()
                } catch (e: SocketException) {
                    if (running) Log.e(TAG, "Accept failed", e)
                    break
                } ?: break

                Log.i(TAG, "Client connected: ${client.remoteSocketAddress}")
                scope.launch { handleClient(client) }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Server error", e)
        } finally {
            Log.i(TAG, "Server stopped")
        }
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        scope.cancel()
    }

    private suspend fun handleClient(socket: Socket) {
        try {
            socket.use { s ->
                s.tcpNoDelay = true
                val reader = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
                val writer = PrintWriter(s.getOutputStream(), true)

                while (running && !s.isClosed) {
                    val line = try {
                        reader.readLine()
                    } catch (e: SocketException) {
                        Log.d(TAG, "Client read error: ${e.message}")
                        null
                    }

                    if (line == null) {
                        Log.i(TAG, "Client disconnected")
                        break
                    }

                    if (line.isBlank()) continue

                    val response = try {
                        commandHandler.handle(line)
                    } catch (e: Exception) {
                        Log.e(TAG, "Unhandled error processing command", e)
                        """{"id":null,"error":{"type":"INTERNAL_ERROR","message":"${e.message?.replace("\"", "\\\"") ?: "Unknown error"}"}}"""
                    }

                    try {
                        writer.println(response)
                        writer.flush()
                    } catch (e: SocketException) {
                        Log.d(TAG, "Client write error: ${e.message}")
                        break
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Client handler error", e)
        }
    }
}
