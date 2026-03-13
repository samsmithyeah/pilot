package dev.pilot.agent

import android.app.Instrumentation
import android.os.Bundle
import android.util.Log
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Entry point for the Pilot on-device agent.
 *
 * Launched via `adb shell am instrument -w dev.pilot.agent/.PilotAgent`.
 * Initializes UIAutomator's UiDevice and starts the TCP socket server
 * that accepts commands from the host daemon.
 */
class PilotAgent : Instrumentation() {

    companion object {
        private const val TAG = "PilotAgent"
        private const val DEFAULT_PORT = 18700
        private const val ARG_PORT = "port"

        @Volatile
        lateinit var device: UiDevice
            private set
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var socketServer: SocketServer? = null

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        Log.i(TAG, "PilotAgent starting")

        device = UiDevice.getInstance(this)

        val port = arguments?.getString(ARG_PORT)?.toIntOrNull() ?: DEFAULT_PORT

        val elementFinder = ElementFinder(device)
        val actionExecutor = ActionExecutor(device)
        val waitEngine = WaitEngine(device)
        val hierarchyDumper = HierarchyDumper(device)
        val commandHandler = CommandHandler(
            device = device,
            elementFinder = elementFinder,
            actionExecutor = actionExecutor,
            waitEngine = waitEngine,
            hierarchyDumper = hierarchyDumper
        )

        socketServer = SocketServer(port, commandHandler)

        scope.launch {
            socketServer?.start()
        }

        Log.i(TAG, "PilotAgent started on port $port")

        // Keep instrumentation alive — do not call finish().
        start()
    }

    override fun onStart() {
        super.onStart()
        // Block the instrumentation thread to keep the process alive.
        synchronized(this) {
            @Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN")
            (this as java.lang.Object).wait()
        }
    }

    override fun onDestroy() {
        Log.i(TAG, "PilotAgent shutting down")
        socketServer?.stop()
        super.onDestroy()
    }
}
