#!/usr/bin/env python3

import subprocess
import sys
import os
import json
import threading
import time
import signal # Import signal to handle process termination

# --- Configuration ---
PROFILES_FILE = "ssh_profiles.json"

# --- Global variables ---
SSH_PROFILES = {}
active_ssh_process = None # To store the currently active SSH subprocess

# --- Functions for loading and saving profiles ---
def load_profiles():
    """Loads SSH profiles from a JSON file."""
    global SSH_PROFILES
    if os.path.exists(PROFILES_FILE):
        try:
            with open(PROFILES_FILE, 'r') as f:
                # Handle empty file case
                content = f.read()
                if not content:
                    SSH_PROFILES = {}
                    return
                SSH_PROFILES = json.loads(content)
                # Ensure loaded data is a dictionary
                if not isinstance(SSH_PROFILES, dict):
                     send_response({"type": "error", "message": f"Profile file {PROFILES_FILE} contains invalid data format (not a dictionary). Resetting profiles."})
                     SSH_PROFILES = {}

        except json.JSONDecodeError:
            send_response({"type": "error", "message": f"Could not decode JSON from {PROFILES_FILE}. File might be corrupted. Resetting profiles."})
            SSH_PROFILES = {} # Start with empty profiles if file is corrupted
        except Exception as e:
            send_response({"type": "error", "message": f"An error occurred while loading profiles from {PROFILES_FILE}: {e}. Resetting profiles."})
            SSH_PROFILES = {}
    else:
        SSH_PROFILES = {} # Start with empty profiles if file doesn't exist

def save_profiles():
    """Saves current SSH profiles to a JSON file."""
    try:
        with open(PROFILES_FILE, 'w') as f:
            json.dump(SSH_PROFILES, f, indent=4)
        return True, None
    except Exception as e:
        return False, f"An error occurred while saving profiles to {PROFILES_FILE}: {e}"

# --- Communication Functions ---
def send_response(message):
    """Sends a JSON message to stdout."""
    try:
        # Ensure message is a dictionary before dumping
        if isinstance(message, dict):
            print(json.dumps(message), flush=True)
        else:
            # Log an error if trying to send non-dict message
            sys.stderr.write(f"Attempted to send non-dictionary message: {message}\n")
            print(json.dumps({"type": "error", "message": "Internal backend error: Attempted to send non-dictionary message."}), flush=True)

    except Exception as e:
        sys.stderr.write(f"Failed to send response: {e}\n")
        # Attempt to send a basic error message if dumping fails
        try:
            print(json.dumps({"type": "error", "message": "Internal backend error: Failed to serialize response."}), flush=True)
        except:
            pass # Give up if even basic error sending fails

# --- Connection Status Management ---
def update_connection_status(status, message=""):
    """Sends a connection status update to the frontend."""
    send_response({"type": "connection_status", "status": status, "message": message})

# --- Core Logic Functions ---
def build_ssh_command(profile_name):
    """Builds the ssh command string for a given profile."""
    profile = SSH_PROFILES.get(profile_name)
    if not profile:
        return None, f"Error: Profile '{profile_name}' not found."

    hostname = profile.get("hostname")
    username = profile.get("username")
    port = profile.get("port", 22)

    if not hostname:
        return None, f"Error: Hostname not specified for profile '{profile_name}'."

    command = ["ssh"]

    if port is not None and str(port).isdigit() and int(port) != 22:
        command.extend(["-p", str(port)])
    elif port is not None and not str(port).isdigit():
         sys.stderr.write(f"Warning: Invalid port specified for profile '{profile_name}': {port}. Using default 22.\n")


    forwards = profile.get("forwards", [])
    if not isinstance(forwards, list):
         sys.stderr.write(f"Warning: 'forwards' for profile '{profile_name}' is not a list. Skipping forwards.\n")
         forwards = []

    valid_forwards = []
    for i, fwd in enumerate(forwards):
        if isinstance(fwd, dict):
            local_port = fwd.get("local_port")
            remote_host = fwd.get("remote_host")
            remote_port = fwd.get("remote_port")

            if local_port is not None and remote_host and remote_port is not None:
                if str(local_port).isdigit() and str(remote_port).isdigit():
                     command.extend(["-L", f"{local_port}:{remote_host}:{remote_port}"])
                     valid_forwards.append(fwd)
                else:
                     sys.stderr.write(f"Warning: Invalid port number in forward rule {i+1} for profile '{profile_name}': {fwd}. Skipping.\n")
            else:
                sys.stderr.write(f"Warning: Incomplete port forward rule {i+1} in profile '{profile_name}': {fwd}. Skipping.\n")
        else:
             sys.stderr.write(f"Warning: Invalid format for forward rule {i+1} in profile '{profile_name}': {fwd}. Skipping.\n")

    if len(valid_forwards) != len(forwards):
         profile['forwards'] = valid_forwards


    if username:
        command.append(f"{username}@{hostname}")
    else:
        command.append(hostname)

    command.append("-N") # Do not execute a remote command
    command.append("-v") # Add verbose output for debugging connection issues

    return command, None

def connect_to_profile(profile_name):
    """Connects to an SSH profile."""
    global active_ssh_process

    if active_ssh_process and active_ssh_process.poll() is None:
        update_connection_status("Error", "Already connected to an SSH server.")
        return

    command, error = build_ssh_command(profile_name)

    if error:
        update_connection_status("Error", error)
        return

    update_connection_status("Connecting...", f"Attempting to connect to '{profile_name}'...")
    sys.stderr.write(f"Executing command: {' '.join(command)}\n")

    try:
        # Start the SSH process
        # Use preexec_fn=os.setsid to create a new process group,
        # which helps in reliably killing the process and its children.
        # Use stdout=subprocess.PIPE and stderr=subprocess.PIPE to capture output
        # for potential debugging, though the main interaction is the terminal window.
        active_ssh_process = subprocess.Popen(
            command,
            shell=False, # Prefer shell=False for better security and control
            preexec_fn=os.setsid,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # Start threads to read stdout and stderr to prevent blocking
        threading.Thread(target=read_process_output, args=(active_ssh_process.stdout, "stdout")).start()
        threading.Thread(target=read_process_output, args=(active_ssh_process.stderr, "stderr")).start()


        # Start a thread to monitor the process exit
        threading.Thread(target=monitor_ssh_process, args=(active_ssh_process, profile_name)).start()

        # Initial status update (process started, but not necessarily connected yet)
        # The monitor_ssh_process thread will send "Connected" status later if successful
        # For now, the "Connecting..." status is sent before Popen.

    except FileNotFoundError:
        update_connection_status("Error", "'ssh' command not found. Is OpenSSH installed and in your PATH?")
        active_ssh_process = None # Reset process variable
    except Exception as e:
        update_connection_status("Error", f"An unexpected error occurred while starting SSH process: {e}")
        active_ssh_process = None # Reset process variable

def disconnect_active_connection():
    """Terminates the active SSH process."""
    global active_ssh_process
    if active_ssh_process and active_ssh_process.poll() is None:
        update_connection_status("Disconnecting...", "Attempting to disconnect...")
        try:
            # Use os.killpg to kill the entire process group
            os.killpg(os.getpgid(active_ssh_process.pid), signal.SIGTERM) # Or signal.SIGKILL for forceful
            # The monitor_ssh_process thread will detect the termination and update status
        except ProcessLookupError:
             sys.stderr.write("Attempted to kill non-existent process.\n")
             update_connection_status("Disconnected", "Connection already terminated.")
             active_ssh_process = None
        except Exception as e:
            update_connection_status("Error", f"An error occurred while trying to disconnect: {e}")
            sys.stderr.write(f"Error killing process: {e}\n")
    else:
        update_connection_status("Disconnected", "No active connection to disconnect.")
        active_ssh_process = None # Ensure variable is None if process is gone

def monitor_ssh_process(process, profile_name):
    """Monitors the SSH process for exit and updates status."""
    global active_ssh_process # <-- Moved this line to the top

    # Wait for the process to finish
    # We could add logic here to detect "Connected" status from stdout/stderr,
    # but for simplicity, we'll assume the process staying alive means connected.
    # A more advanced version would parse SSH output for connection success messages.

    # Give SSH a moment to establish connection and potentially print errors
    time.sleep(2) # Adjust this delay as needed

    if process.poll() is None:
        # Process is still running, assume connected
        update_connection_status("Connected", f"Successfully connected to '{profile_name}'.")
    else:
        # Process exited quickly, likely an error
        stdout, stderr = process.communicate() # Get remaining output
        error_message = stderr.decode().strip()
        if error_message:
            update_connection_status("Error", f"SSH connection failed: {error_message}")
        else:
             update_connection_status("Error", f"SSH process exited unexpectedly (code {process.returncode}).")
        # Do NOT set active_ssh_process = None here, it will be set after process.wait()


    process.wait() # Wait for the process to fully terminate

    # Process has exited (either normally or due to signal)
    returncode = process.returncode
    if active_ssh_process is process: # Only update if this is still the active process
        if returncode == 0:
            update_connection_status("Disconnected", "SSH connection closed.")
        elif returncode is not None: # Non-zero exit code
             # Check if it was likely terminated by signal (e.g., SIGTERM from disconnect)
             # Negative return codes often indicate termination by signal (-signal.SIGTERM)
             if returncode < 0:
                 update_connection_status("Disconnected", "SSH connection terminated.")
             else:
                update_connection_status("Error", f"SSH process exited with code {returncode}.")
        else: # returncode is None, but wait() returned - process finished
             update_connection_status("Disconnected", "SSH connection closed.")

        active_ssh_process = None # Reset process variable


def read_process_output(pipe, name):
    """Reads output from a process pipe and prints it to stderr."""
    # This helps in debugging the SSH command itself by seeing its output
    for line in iter(pipe.readline, b''):
        sys.stderr.write(f"SSH {name}: {line.decode()}")
    pipe.close()


def handle_request(request):
    """Handles incoming requests from the frontend."""
    request_type = request.get("type")

    if not isinstance(request, dict):
        send_response({"type": "error", "message": "Invalid request format (not a dictionary)."})
        return
    if not request_type or not isinstance(request_type, str):
         send_response({"type": "error", "message": "Invalid request format (missing or invalid 'type')."})
         return


    if request_type == "list_profiles":
        send_response({"type": "profiles_list", "data": SSH_PROFILES})

    elif request_type == "get_profile_details":
        profile_name = request.get("profile_name")
        if not profile_name or not isinstance(profile_name, str):
             send_response({"type": "error", "message": "Invalid request for profile details (missing or invalid 'profile_name')."})
             return

        profile = SSH_PROFILES.get(profile_name)
        if profile:
            send_response({"type": "profile_details", "profile_name": profile_name, "data": profile})
        else:
            send_response({"type": "error", "message": f"Profile '{profile_name}' not found."})

    elif request_type == "get_profile_details_for_edit":
        profile_name = request.get("profile_name")
        if not profile_name or not isinstance(profile_name, str):
             send_response({"type": "error", "message": "Invalid request for profile details for edit (missing or invalid 'profile_name')."})
             return

        profile = SSH_PROFILES.get(profile_name)
        if profile:
            profile_data_with_name = profile.copy()
            profile_data_with_name['name'] = profile_name
            send_response({"type": "profile_details_for_edit", "data": profile_data_with_name})
        else:
            send_response({"type": "error", "message": f"Profile '{profile_name}' not found for editing."})


    elif request_type in ["add_profile", "save_profile"]:
        profile_name = request.get("profile_name")
        profile_data = request.get("data")

        if not profile_name or not isinstance(profile_name, str):
             send_response({"type": "error", "message": f"Invalid request for {request_type} (missing or invalid 'profile_name')."})
             return
        if not profile_data or not isinstance(profile_data, dict):
             send_response({"type": "error", "message": f"Invalid request for {request_type} (missing or invalid 'data')."})
             return

        if not isinstance(profile_data.get("hostname"), str) or not profile_data.get("hostname"):
             send_response({"type": "error", "message": f"Invalid profile data for '{profile_name}': Hostname is required and must be a string."})
             return
        if profile_data.get("username") is not None and not isinstance(profile_data.get("username"), str):
             send_response({"type": "error", "message": f"Invalid profile data for '{profile_name}': Username must be a string or null."})
             return
        port = profile_data.get("port")
        if port is not None and (not isinstance(port, int) or port <= 0 or port > 65535):
             send_response({"type": "error", "message": f"Invalid profile data for '{profile_name}': Port must be a valid integer between 1 and 65535."})
             return
        forwards = profile_data.get("forwards")
        if forwards is not None and not isinstance(forwards, list):
             send_response({"type": "error", "message": f"Invalid profile data for '{profile_name}': Forwards must be a list."})
             return
        if isinstance(forwards, list):
            for i, fwd in enumerate(forwards):
                if not isinstance(fwd, dict) or \
                   not isinstance(fwd.get("local_port"), int) or fwd.get("local_port") <= 0 or fwd.get("local_port") > 65535 or \
                   not isinstance(fwd.get("remote_host"), str) or not fwd.get("remote_host") or \
                   not isinstance(fwd.get("remote_port"), int) or fwd.get("remote_port") <= 0 or fwd.get("remote_port") > 65535:
                    send_response({"type": "error", "message": f"Invalid profile data for '{profile_name}': Invalid forward rule at index {i}. Check local_port (int), remote_host (string), remote_port (int)."})
                    return

        if request_type == "add_profile":
            if profile_name in SSH_PROFILES:
                 send_response({"type": "error", "message": f"Profile '{profile_name}' already exists."})
                 return
            SSH_PROFILES[profile_name] = profile_data
            saved, error = save_profiles()
            if saved:
                send_response({"type": "profile_saved", "message": f"Profile '{profile_name}' added successfully."})
            else:
                send_response({"type": "error", "message": f"Failed to save profile '{profile_name}': {error}"})

        elif request_type == "save_profile":
            if profile_name not in SSH_PROFILES:
                 send_response({"type": "error", "message": f"Profile '{profile_name}' not found for saving."})
                 return
            SSH_PROFILES[profile_name] = profile_data
            saved, error = save_profiles()
            if saved:
                send_response({"type": "profile_saved", "message": f"Profile '{profile_name}' saved successfully."})
            else:
                send_response({"type": "error", "message": f"Failed to save profile '{profile_name}': {error}"})


    elif request_type == "delete_profile":
        profile_name = request.get("profile_name")
        if not profile_name or not isinstance(profile_name, str):
             send_response({"type": "error", "message": "Invalid request for deleting profile (missing or invalid 'profile_name')."})
             return

        if profile_name in SSH_PROFILES:
            del SSH_PROFILES[profile_name]
            saved, error = save_profiles()
            if saved:
                send_response({"type": "profile_deleted", "message": f"Profile '{profile_name}' deleted successfully."})
            else:
                send_response({"type": "error", "message": f"Failed to delete profile '{profile_name}': {error}"})
        else:
            send_response({"type": "error", "message": f"Profile '{profile_name}' not found for deletion."})

    elif request_type == "connect":
        profile_name = request.get("profile_name")
        if not profile_name or not isinstance(profile_name, str):
             send_response({"type": "error", "message": "Invalid request for connecting (missing or invalid 'profile_name')."})
             return
        connect_to_profile(profile_name)

    elif request_type == "disconnect":
        disconnect_active_connection()

    else:
        send_response({"type": "error", "message": f"Unknown request type: {request_type}"})

def listen_for_requests():
    """Listens for JSON requests on stdin."""
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            request = json.loads(line)
            handle_request(request)
        except json.JSONDecodeError:
            send_response({"type": "error", "message": "Invalid JSON received from frontend."})
        except Exception as e:
            send_response({"type": "error", "message": f"An unexpected error occurred while processing request: {e}"})


if __name__ == "__main__":
    load_profiles()
    update_connection_status("Disconnected", "Application started.") # Initial status

    request_listener_thread = threading.Thread(target=listen_for_requests)
    request_listener_thread.daemon = True
    request_listener_thread.start()

    try:
        while request_listener_thread.is_alive():
            time.sleep(0.1)
    except KeyboardInterrupt:
        sys.stderr.write("Backend interrupted by user (KeyboardInterrupt).\n")
        # Attempt to disconnect SSH process on backend exit
        disconnect_active_connection()
        sys.exit(0)
    except Exception as e:
        sys.stderr.write(f"An error occurred in the main backend thread: {e}\n")
        # Attempt to disconnect SSH process on backend exit
        disconnect_active_connection()
        sys.exit(1)
    finally:
         # Ensure SSH process is terminated if the main thread exits for other reasons
         disconnect_active_connection()

