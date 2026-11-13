const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

window.COUESNON_API_BASE_URL = isLocal
  ? "http://localhost:3000"
  : "https://balance-connectee-l0b9.onrender.com";