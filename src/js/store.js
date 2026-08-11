import {
  collection,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

let unsubscribers = [];

export const dataStore = {
  transactions: [],
  budgets: [],
  goals: [],
  loading: {
    transactions: true,
    budgets: true,
    goals: true
  },
  error: {
    transactions: false,
    budgets: false,
    goals: false
  }
};

const listeners = new Set();

/**
 * Subscribes a callback to store changes.
 * The callback is immediately invoked with the current store state.
 * @param {Function} cb
 * @returns {Function} Unsubscribe function
 */
export function subscribeToStore(cb) {
  listeners.add(cb);
  cb(dataStore); // Immediate initial call
  return () => listeners.delete(cb);
}

/**
 * Notifies all listeners of a state change.
 */
function notify() {
  listeners.forEach(cb => cb(dataStore));
}

/**
 * Initializes the realtime listeners for the authenticated user.
 * @param {string} uid
 */
export function initStore(uid) {
  cleanupStore();

  const txnCol = collection(db, "users", uid, "transactions");
  const budgetCol = collection(db, "users", uid, "budgets");
  const goalCol = collection(db, "users", uid, "goals");

  unsubscribers.push(
    onSnapshot(query(txnCol, orderBy("date", "desc")), (snapshot) => {
      dataStore.transactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      dataStore.loading.transactions = false;
      dataStore.error.transactions = false;
      notify();
    }, (error) => {
      console.error("Transactions snapshot error:", error);
      dataStore.loading.transactions = false;
      dataStore.error.transactions = true;
      notify();
    })
  );

  unsubscribers.push(
    onSnapshot(query(budgetCol, orderBy("createdAt", "desc")), (snapshot) => {
      dataStore.budgets = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      dataStore.loading.budgets = false;
      dataStore.error.budgets = false;
      notify();
    }, (error) => {
      console.error("Budgets snapshot error:", error);
      dataStore.loading.budgets = false;
      dataStore.error.budgets = true;
      notify();
    })
  );

  unsubscribers.push(
    onSnapshot(query(goalCol, orderBy("deadline", "asc")), (snapshot) => {
      dataStore.goals = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      dataStore.loading.goals = false;
      dataStore.error.goals = false;
      notify();
    }, (error) => {
      console.error("Goals snapshot error:", error);
      dataStore.loading.goals = false;
      dataStore.error.goals = true;
      notify();
    })
  );
}

/**
 * Unsubscribes from all listeners and resets the store.
 */
export function cleanupStore() {
  unsubscribers.forEach(unsub => unsub());
  unsubscribers = [];
  dataStore.transactions = [];
  dataStore.budgets = [];
  dataStore.goals = [];
  dataStore.loading = { transactions: true, budgets: true, goals: true };
  dataStore.error = { transactions: false, budgets: false, goals: false };
  // We don't clear `listeners` here because the UI components might still be mounted
  // and will just receive the empty state, which correctly reflects the logged-out state.
}
