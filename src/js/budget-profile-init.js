import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { auth } from "./firebase-config.js";
import { initProfileManager } from "./profile-manager.js";

onAuthStateChanged(auth, (user) => {
  if (user) initProfileManager(user).catch((error) => console.error("Could not load profile:", error));
});
