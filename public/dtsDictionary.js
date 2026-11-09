import { Obd2Service } from './obd2Service.js';
import { Obd2Parser } from './obd2Parser.js';

// DOM Element Registry
const connectBtn = document.getElementById('connectBtn');
const scanDtcBtn = document.getElementById('scanDtcBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const rpmValue = document.getElementById('rpmValue');
const speedValue = document.getElementById('speedValue');
const dtcContainer = document.getElementById('dtcContainer');

let liveDataInterval = null;

// Handle Initial Adapter Search/Connection Routine
connectBtn.addEventListener('click', () => {
  statusText.innerText = "Scanning...";
  connectBtn.disabled = true;

  Obd2Service.scanForAdapter(async (device) => {
    statusText.innerText = `Connecting to ${device.name || 'Adapter'}...`;
    
    // Attempt link using device payload identifiers via core BLE plugins
    await Obd2Service.connectToAdapter(device.id, handleLiveStreamBytes);
    
    // UI Updates following execution
    statusDot.classList.add('connected');
    statusText.innerText = "Connected";
    connectBtn.innerText = "Disconnect";
    connectBtn.disabled = false;
    scanDtcBtn.disabled = false;
    
    // Begin continuous background updates (request telemetry data every 500ms)
    startLivePolling();
  });
});

// Periodic Request Loop (Alters commands sequentially to avoid bandwidth collision)
function startLivePolling() {
  let toggle = true;
  liveDataInterval = setInterval(() => {
    if (toggle) {
      Obd2Service.requestEngineRPM();
    } else {
      Obd2Service.requestVehicleSpeed();
    }
    toggle = !toggle;
  }, 500);
}

// Global Parser router binding raw streams back onto specific elements
function handleLiveStreamBytes(rawString) {
  if (rawString.includes("41 0C") || rawString.includes("410C")) {
    const rpm = Obd2Parser.parseRPM(rawString);
    if (rpm !== null) rpmValue.innerText = rpm;
  } 
  
  else if (rawString.includes("41 0D") || rawString.includes("410D")) {
    const speed = Obd2Parser.parseSpeed(rawString, false);
    if (speed !== null) speedValue.innerText = speed;
  } 
  
  else if (rawString.includes("43")) {
    const codes = Obd2Parser.parseTroubleCodes(rawString);
    renderTroubleCodes(codes);
  }
}

// Request Stored Vehicle ECU Error Arrays 
scanDtcBtn.addEventListener('click', () => {
  dtcContainer.innerHTML = '<div class="no-faults" style="color: var(--text-muted)">Querying codes...</div>';
  Obd2Service.requestTroubleCodes();
});

// UI Code Renderer for Active Engine Malfunctions
function renderTroubleCodes(codesArray) {
  dtcContainer.innerHTML = ''; // Clear fallback states

  if (codesArray.length === 0) {
    dtcContainer.innerHTML = '<div class="no-faults">🎉 System Clear! No Engine Error Codes detected.</div>';
    return;
  }

  codesArray.forEach(code => {
    const item = document.createElement('div');
    item.className = 'dtc-item';
    item.innerHTML = `
      <span class="dtc-code">${code}</span>
      <span style="color: var(--text-muted); font-size: 0.85rem;">Fault Code Detected</span>
    `;
    dtcContainer.appendChild(item);
  });
}
