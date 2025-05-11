
(() => {
// Access the exposed API from the preload script
const electronAPI = window.electronAPI;

// Get references to UI elements
const profileSelect = document.getElementById('profile-select');
const connectButton = document.getElementById('connect-button');
const disconnectButton = document.getElementById('disconnect-button');
const editButton = document.getElementById('edit-button');
const deleteButton = document.getElementById('delete-button');
const profileDetailsText = document.getElementById('profile-details-text');

const statusText = document.getElementById('status-text'); // Get status text element

const addEditTitle = document.getElementById('add-edit-title');
const profileNameInput = document.getElementById('profile-name');
const hostnameInput = document.getElementById('hostname');
const usernameInput = document.getElementById('username');
const portInput = document.getElementById('port');
const portForwardsContainer = document.getElementById('port-forwards-container');
const addForwardButton = document.getElementById('add-forward-button');
const saveProfileButton = document.getElementById('save-profile-button');

// Get error message elements
const profileNameError = document.getElementById('profile-name-error');
const hostnameError = document.getElementById('hostname-error');
const usernameError = document.getElementById('username-error');
const portError = document.getElementById('port-error');


let editingProfileName = null; // To keep track of the profile being edited

// --- Helper function to update button states ---
function updateButtonStates(isConnected) {
    connectButton.disabled = isConnected;
    disconnectButton.disabled = !isConnected;
    // Disable edit/delete while connected to avoid modifying an active profile
    editButton.disabled = isConnected || profileSelect.disabled;
    deleteButton.disabled = isConnected || profileSelect.disabled;
    // Disable add/save while connected
    addForwardButton.disabled = isConnected;
    saveProfileButton.disabled = isConnected;

    // Disable input fields in the add/edit section while connected
    profileNameInput.disabled = isConnected || (editingProfileName !== null); // Disable name input if connected or editing
    hostnameInput.disabled = isConnected;
    usernameInput.disabled = isConnected;
    portInput.disabled = isConnected;

    // Disable individual forward inputs and remove buttons while connected
    portForwardsContainer.querySelectorAll('input').forEach(input => {
        input.disabled = isConnected;
    });
     portForwardsContainer.querySelectorAll('.remove-button').forEach(button => {
        button.disabled = isConnected;
    });
}

// --- Helper function to clear validation errors ---
function clearValidationErrors() {
    profileNameInput.classList.remove('error');
    hostnameInput.classList.remove('error');
    usernameInput.classList.remove('error');
    portInput.classList.remove('error');

    profileNameError.textContent = '';
    hostnameError.textContent = '';
    usernameError.textContent = '';
    portError.textContent = '';

    portForwardsContainer.querySelectorAll('.port-forward-entry input').forEach(input => {
        input.classList.remove('error');
    });
}


// --- IPC Communication Handlers ---
// Listen for responses from the backend process
electronAPI.onBackendResponse((message) => {
    console.log('Received from backend:', message); // Log all incoming messages

    // Handle different types of messages from the backend using a switch statement
    switch (message.type) {
        case 'profiles_list':
            // Update the profile dropdown list
            updateProfileList(message.data);
            break;
        case 'profile_saved':
        case 'profile_deleted':
            // After saving or deleting, request the updated list of profiles
            requestProfilesList();
            // Clear the add/edit form after saving a new profile or after deleting
            if (message.type === 'profile_saved' && editingProfileName === null) {
                 clearProfileForm();
            } else if (message.type === 'profile_deleted') {
                  clearProfileForm();
            }
            // Show a success message to the user
            alert(message.message);
            break;
        case 'connection_status':
            // Update the connection status display and button states
            statusText.textContent = message.status;
            // Update status text class for styling
            statusText.className = ''; // Clear existing classes
            if (message.status === 'Connected') {
                statusText.classList.add('Connected');
                updateButtonStates(true);
            } else if (message.status === 'Connecting...') {
                 statusText.classList.add('Connecting');
                 updateButtonStates(true); // Still disable connect, enable disconnect optimistically
            } else if (message.status === 'Disconnected') {
                 statusText.classList.add('Disconnected');
                 updateButtonStates(false);
                 alert(message.message); // Alert on disconnection
             } else if (message.status.startsWith('Error:')) {
                 statusText.classList.add('Error');
                 updateButtonStates(false); // Revert buttons on error
                 alert(message.message); // Alert on connection error
             } else {
                 statusText.classList.add('Disconnected'); // Default to disconnected for unknown status
                 updateButtonStates(false);
             }
            break;
        case 'profile_details':
            // Display detailed information about the selected profile
            displayProfileDetails(message.profile_name, message.data);
            break;
        case 'profile_details_for_edit':
            // Populate the add/edit form with data from the profile to be edited
            populateProfileForm(message.data);
            break;
        case 'error':
            // Display error messages from the backend
            alert('Backend Error: ' + message.message);
            // If an error occurs during connection attempt, update status
            if (statusText.textContent === 'Connecting...') {
                 statusText.textContent = 'Error: Connection Failed';
                 statusText.className = '';
                 statusText.classList.add('Error');
                 updateButtonStates(false);
            }
            break;
        default:
            console.warn('Received unknown message type from backend:', message.type);
            // Optionally alert or log unknown messages
            // alert('Received unknown message from backend.');
    }
});

// Listen for errors specifically from the backend's stderr
electronAPI.onBackendError((message) => {
    console.error('Backend Error (stderr):', message);
    // Optionally display these errors to the user, maybe in a separate log area
    // alert('Backend Error: ' + message); // Avoid too many disruptive alerts
});

// Listen for the backend process closing
electronAPI.onBackendClosed((code) => {
    console.warn('Backend process closed with code:', code);
    // Inform the user that the backend is no longer running
    alert('The backend process has closed. Please restart the application.');
    // Update status and disable all interaction buttons
    statusText.textContent = 'Backend Offline';
    statusText.className = '';
    statusText.classList.add('Error'); // Indicate an error state
    updateButtonStates(false); // Disable all buttons
    profileSelect.disabled = true; // Disable profile selection
    // Disable all input fields and remove buttons
    profileNameInput.disabled = true;
    hostnameInput.disabled = true;
    usernameInput.disabled = true;
    portInput.disabled = true;
     portForwardsContainer.querySelectorAll('input').forEach(input => {
        input.disabled = true;
    });
     portForwardsContainer.querySelectorAll('.remove-button').forEach(button => {
        button.disabled = true;
    });
});

// --- UI Update Functions ---
function updateProfileList(profiles) {
    // Clear existing options in the select dropdown
    profileSelect.innerHTML = '';
    const sortedProfileNames = Object.keys(profiles).sort();

    if (sortedProfileNames.length === 0) {
        // Add a placeholder option if no profiles exist
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No profiles available';
        profileSelect.appendChild(option);
        // Disable buttons that require a selected profile
        profileSelect.disabled = true;
        editButton.disabled = true; // Disable edit/delete when no profiles
        deleteButton.disabled = true;
        profileDetailsText.textContent = 'No profiles available.';
    } else {
        // Enable buttons and populate the dropdown with profile names
        profileSelect.disabled = false;
        editButton.disabled = false; // Enable edit/delete when profiles exist
        deleteButton.disabled = false;
        sortedProfileNames.forEach(profileName => {
            const option = document.createElement('option');
            option.value = profileName;
            option.textContent = profileName;
            profileSelect.appendChild(option);
        });
        // Select the first profile by default and display its details
        profileSelect.value = sortedProfileNames[0];
        updateProfileDetails();
    }
    // Ensure button states are correct after updating the list
    updateButtonStates(statusText.textContent === 'Connected' || statusText.textContent === 'Connecting...');

}

function updateProfileDetails() {
    const selectedProfileName = profileSelect.value;
    if (!selectedProfileName) {
        profileDetailsText.textContent = 'Select a profile from the list.';
        return;
    }

    // Request the details of the selected profile from the backend
    electronAPI.sendBackendRequest({ type: 'get_profile_details', profile_name: selectedProfileName });
}

function displayProfileDetails(profileName, profile) {
     // Format and display the profile details in the preformatted text area
    let details = `Profile: ${profileName}\n`;
    details += `Hostname: ${profile.hostname || 'N/A'}\n`;
    details += `Username: ${profile.username || 'N/A'}\n`;
    details += `SSH Port: ${profile.port || 22}\n`;
    details += "Port Forwards (-L local:remote_host:remote_port):\n";
    const forwards = profile.forwards || [];
    if (forwards.length > 0) {
        forwards.forEach(fwd => {
            details += `  - ${fwd.local_port || '?'}:${fwd.remote_host || '?'}:${fwd.remote_port || '?'}\n`;
        });
    } else {
        details += "  No port forwards configured.\n";
    }
    profileDetailsText.textContent = details;
}


function addPortForwardEntry(localPort = '', remoteHost = '', remotePort = '') {
    // Create a new div to hold the port forward input fields and remove button
    const entryDiv = document.createElement('div');
    entryDiv.classList.add('port-forward-entry'); // Add class for styling and selection

    // Create input fields for local port, remote host, and remote port
    const localPortInput = document.createElement('input');
    localPortInput.type = 'number';
    localPortInput.placeholder = 'Local Port';
    localPortInput.value = localPort;
    localPortInput.min = 1; // Add basic validation
    localPortInput.max = 65535;

    const colon1 = document.createElement('span');
    colon1.textContent = ':';

    const remoteHostInput = document.createElement('input');
    remoteHostInput.type = 'text';
    remoteHostInput.placeholder = 'Remote Host';
    remoteHostInput.value = remoteHost;

    const colon2 = document.createElement('span');
    colon2.textContent = ':';

    const remotePortInput = document.createElement('input');
    remotePortInput.type = 'number';
    remotePortInput.placeholder = 'Remote Port';
    remotePortInput.value = remotePort;
    remotePortInput.min = 1; // Add basic validation
    remotePortInput.max = 65535;

    // Create a button to remove this port forward entry
    const removeButton = document.createElement('button');
    removeButton.textContent = 'Remove';
    removeButton.classList.add('remove-button'); // Add class for styling
    removeButton.onclick = () => {
        // Remove the parent div (which contains all inputs and the remove button)
        portForwardsContainer.removeChild(entryDiv);
    };

    // Append the created elements to the entry div
    entryDiv.appendChild(localPortInput);
    entryDiv.appendChild(colon1);
    entryDiv.appendChild(remoteHostInput);
    entryDiv.appendChild(colon2);
    entryDiv.appendChild(remotePortInput);
    entryDiv.appendChild(removeButton);

    // Append the entry div to the container in the HTML
    portForwardsContainer.appendChild(entryDiv);
}

function clearPortForwardEntries() {
    // Remove all child elements from the port forwards container
    portForwardsContainer.innerHTML = '';
}

function populateProfileForm(profile = null) {
    // Clear existing port forward entries in the form
    clearPortForwardEntries();
    // Clear any previous validation errors
    clearValidationErrors();

    if (profile) {
        // Populate form for editing an existing profile
        addEditTitle.textContent = `Edit Profile: ${profile.name}`;
        profileNameInput.value = profile.name;
        profileNameInput.disabled = true; // Prevent changing the profile name when editing
        editingProfileName = profile.name; // Store the name of the profile being edited

        hostnameInput.value = profile.hostname || '';
        usernameInput.value = profile.username || '';
        portInput.value = profile.port || 22;

        // Add port forward entries from the profile data
        if (profile.forwards) {
            profile.forwards.forEach(fwd => {
                addPortForwardEntry(fwd.local_port, fwd.remote_host, fwd.remote_port);
            });
        }
        saveProfileButton.textContent = 'Save Changes';
    } else {
        // Clear form for adding a new profile
        addEditTitle.textContent = 'Add New Profile';
        profileNameInput.value = '';
        profileNameInput.disabled = false; // Allow entering a new profile name
        editingProfileName = null; // Not editing any profile

        hostnameInput.value = '';
        usernameInput.value = '';
        portInput.value = 22; // Set default port

        saveProfileButton.textContent = 'Save Profile';
    }
    // Ensure button states are correct after populating the form
    updateButtonStates(statusText.textContent === 'Connected' || statusText.textContent === 'Connecting...');
}

function clearProfileForm() {
     // Simply call populateProfileForm with no profile data to clear it
     populateProfileForm(null);
}

// --- Frontend Input Validation ---
function validateProfileForm() {
    let isValid = true;
    clearValidationErrors(); // Clear previous errors

    const profileName = profileNameInput.value.trim();
    const hostname = hostnameInput.value.trim();
    const port = portInput.value.trim();

    if (!profileName) {
        profileNameInput.classList.add('error');
        profileNameError.textContent = 'Profile Name is required.';
        isValid = false;
    }

    if (!hostname) {
        hostnameInput.classList.add('error');
        hostnameError.textContent = 'Hostname/IP is required.';
        isValid = false;
    }

    // Validate port number
    if (port !== '') {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            portInput.classList.add('error');
            portError.textContent = 'Invalid port (1-65535).';
            isValid = false;
        }
    }

    // Validate port forward entries
    portForwardsContainer.querySelectorAll('.port-forward-entry').forEach(entryDiv => {
        const localPortInput = entryDiv.querySelector('input[placeholder="Local Port"]');
        const remoteHostInput = entryDiv.querySelector('input[placeholder="Remote Host"]');
        const remotePortInput = entryDiv.querySelector('input[placeholder="Remote Port"]');

        const localPort = localPortInput.value.trim();
        const remoteHost = remoteHostInput.value.trim();
        const remotePort = remotePortInput.value.trim();

        // Check if any part of the forward rule is filled
        if (localPort || remoteHost || remotePort) {
            // If any part is filled, all parts must be valid
            let forwardIsValid = true;
            if (!localPort || isNaN(parseInt(localPort, 10)) || parseInt(localPort, 10) < 1 || parseInt(localPort, 10) > 65535) {
                 localPortInput.classList.add('error');
                 forwardIsValid = false;
            }
            if (!remoteHost) {
                 remoteHostInput.classList.add('error');
                 forwardIsValid = false;
            }
             if (!remotePort || isNaN(parseInt(remotePort, 10)) || parseInt(remotePort, 10) < 1 || parseInt(remotePort, 10) > 65535) {
                 remotePortInput.classList.add('error');
                 forwardIsValid = false;
            }
            if (!forwardIsValid) {
                 isValid = false; // Mark overall form as invalid
            }
        }
    });


    return isValid;
}


// --- Event Listeners ---
// Listen for changes in the profile select dropdown
profileSelect.addEventListener('change', updateProfileDetails);

// Listen for click on the Connect button
connectButton.addEventListener('click', () => {
    const selectedProfileName = profileSelect.value;
    if (selectedProfileName) {
        // Send a request to the backend to connect to the selected profile
        electronAPI.sendBackendRequest({ type: 'connect', profile_name: selectedProfileName });
        statusText.textContent = 'Connecting...'; // Optimistically update status
        statusText.className = '';
        statusText.classList.add('Connecting');
        updateButtonStates(true); // Disable connect, enable disconnect
    } else {
        // Show a warning if no profile is selected
        alert('Please select a profile to connect.');
    }
});

// Listen for click on the Disconnect button
disconnectButton.addEventListener('click', () => {
    // Send a request to the backend to disconnect the active SSH connection
    electronAPI.sendBackendRequest({ type: 'disconnect' });
    statusText.textContent = 'Disconnecting...'; // Optimistically update status
    statusText.className = '';
    statusText.classList.add('Connecting'); // Use connecting color for disconnecting
    // Buttons will be updated when backend confirms disconnection
});


// Listen for click on the Edit button
editButton.addEventListener('click', () => {
    const selectedProfileName = profileSelect.value;
    if (selectedProfileName) {
        // Request the details of the selected profile from the backend for editing
         electronAPI.sendBackendRequest({ type: 'get_profile_details_for_edit', profile_name: selectedProfileName });
    } else {
        // Show a warning if no profile is selected
        alert('Please select a profile to edit.');
    }
});


// Listen for click on the Delete button
deleteButton.addEventListener('click', () => {
    const selectedProfileName = profileSelect.value;
    if (selectedProfileName) {
        // Ask for confirmation before deleting
        if (confirm(`Are you sure you want to delete profile '${selectedProfileName}'?`)) {
            // Send a request to the backend to delete the selected profile
            electronAPI.sendBackendRequest({ type: 'delete_profile', profile_name: selectedProfileName });
        }
    } else {
        // Show a warning if no profile is selected
        alert('Please select a profile to delete.');
    }
});

// Listen for click on the Add Port Forward button
addForwardButton.addEventListener('click', () => {
    // Add a new empty set of port forward input fields to the form
    addPortForwardEntry();
});

// Listen for click on the Save Profile button
saveProfileButton.addEventListener('click', () => {
    // Perform frontend validation before sending to backend
    if (!validateProfileForm()) {
        alert('Please fix the errors in the form.');
        return;
    }

    // Get data from the input fields (already trimmed in validation)
    const profileName = profileNameInput.value.trim();
    const hostname = hostnameInput.value.trim();
    const username = usernameInput.value.trim();
    const port = portInput.value.trim();


    // Collect data from all port forward entries
    const forwards = [];
    portForwardsContainer.querySelectorAll('.port-forward-entry').forEach(entryDiv => {
        const localPortInput = entryDiv.querySelector('input[placeholder="Local Port"]');
        const remoteHostInput = entryDiv.querySelector('input[placeholder="Remote Host"]');
        const remotePortInput = entryDiv.querySelector('input[placeholder="Remote Port"]');

        const localPort = localPortInput.value.trim();
        const remoteHost = remoteHostInput.value.trim();
        const remotePort = remotePortInput.value.trim();

        // Only include complete and valid forward rules (validation already done)
        if (localPort && remoteHost && remotePort) {
             forwards.push({
                local_port: parseInt(localPort, 10),
                remote_host: remoteHost,
                remote_port: parseInt(remotePort, 10)
            });
        }
    });

    // Create the profile data object
    const profileData = {
        name: profileName,
        hostname: hostname,
        username: username,
        port: parseInt(port, 10) || 22, // Default to 22 if not a valid number (should be caught by validation)
        forwards: forwards
    };

    // Determine the request type based on whether we are editing or adding
    const requestType = editingProfileName ? 'save_profile' : 'add_profile';

    // Send the profile data to the backend
    electronAPI.sendBackendRequest({
        type: requestType,
        profile_name: profileName, // Send the profile name in the request
        data: profileData
    });
});


// --- Initial Load ---
function requestProfilesList() {
    // Request the initial list of profiles from the backend when the app starts
    electronAPI.sendBackendRequest({ type: 'list_profiles' });
}

// Request the initial list of profiles when the renderer process starts
requestProfilesList();
})();