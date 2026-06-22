const DEFAULT_SETTINGS = {
  showDeleteButton: true,
  showFavoriteStar: true,
  showReadIndicator: true,
};

const toggles = document.querySelectorAll(".toggle-input[data-key]");
const statusBar = document.getElementById("status-bar");
const versionLabel = document.getElementById("version-label");

// Show extension version
if (typeof browser !== "undefined" && browser.runtime?.getManifest) {
  const manifest = browser.runtime.getManifest();
  if (manifest?.version) {
    versionLabel.textContent = `v${manifest.version}`;
  }
}

// Load saved settings and populate toggles
async function loadSettings() {
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  for (const toggle of toggles) {
    const key = toggle.dataset.key;
    if (key in stored) {
      toggle.checked = stored[key];
    }
  }
}

// Save a single key when a toggle changes
async function onToggleChange(event) {
  const key = event.target.dataset.key;
  const value = event.target.checked;
  await browser.storage.local.set({ [key]: value });
  flashSaved();
}

function flashSaved() {
  statusBar.textContent = "✓ Saved";
  statusBar.classList.add("saved");
  clearTimeout(statusBar._timer);
  statusBar._timer = setTimeout(() => {
    statusBar.textContent = "";
    statusBar.classList.remove("saved");
  }, 2000);
}

// Wire up listeners
for (const toggle of toggles) {
  toggle.addEventListener("change", onToggleChange);
}

loadSettings();
