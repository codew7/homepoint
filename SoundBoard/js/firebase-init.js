// Firebase initialization. Uses the global `firebase` from the compat SDKs loaded via CDN.
const firebaseConfig = {
  apiKey: "AIzaSyDYm8_LemgsIXk0HXubZnbuoIh82p5JGjY",
  authDomain: "sound-communicator.firebaseapp.com",
  projectId: "sound-communicator",
  storageBucket: "sound-communicator.firebasestorage.app",
  messagingSenderId: "293242001470",
  appId: "1:293242001470:web:d19287824cbc09c449996f"
};

if (!window.firebase.apps.length) {
  window.firebase.initializeApp(firebaseConfig);
}

export const db = window.firebase.database();
export const storage = window.firebase.storage();
export const firebase = window.firebase;
