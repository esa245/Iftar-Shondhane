import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDmwbrm2YDx_Cbq9TJ53a4N5GcaWXy4zWQ",
  authDomain: "romjan-587e8.firebaseapp.com",
  databaseURL: "https://romjan-587e8-default-rtdb.firebaseio.com",
  projectId: "romjan-587e8",
  storageBucket: "romjan-587e8.firebasestorage.app",
  messagingSenderId: "674859335702",
  appId: "1:674859335702:web:ae7ee586ef489ae2207537",
  measurementId: "G-J91KZKWZEL"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
