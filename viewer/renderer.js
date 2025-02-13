const { ipcRenderer } = require("electron");

ipcRenderer.on("update-screen", (event, data) => {
  const img = document.getElementById("screen");
  img.src = "data:image/png;base64," + data;
});
