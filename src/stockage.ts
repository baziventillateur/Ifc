// Mémoire de l'appareil (IndexedDB) : maquettes converties et remarques.
// Rien ne quitte le navigateur.

const BASE = "visionneuse-ifc";
const MAGASINS = ["maquettes", "remarques"] as const;
type Magasin = (typeof MAGASINS)[number];

let ouverture: Promise<IDBDatabase> | null = null;

function base(): Promise<IDBDatabase> {
  if (!ouverture) {
    ouverture = new Promise((resoudre, rejeter) => {
      const req = indexedDB.open(BASE, 1);
      req.onupgradeneeded = () => {
        for (const nom of MAGASINS) {
          if (!req.result.objectStoreNames.contains(nom)) req.result.createObjectStore(nom);
        }
      };
      req.onsuccess = () => resoudre(req.result);
      req.onerror = () => rejeter(req.error);
    });
    ouverture.catch(() => (ouverture = null));
  }
  return ouverture;
}

async function transaction<T>(
  magasin: Magasin,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await base();
  return new Promise((resoudre, rejeter) => {
    const tx = db.transaction(magasin, mode);
    const req = action(tx.objectStore(magasin));
    tx.oncomplete = () => resoudre(req ? req.result : undefined);
    tx.onerror = () => rejeter(tx.error);
    tx.onabort = () => rejeter(tx.error);
  });
}

export async function lireTout<T>(magasin: Magasin): Promise<T[]> {
  try {
    return ((await transaction(magasin, "readonly", (s) => s.getAll())) as T[]) ?? [];
  } catch (e) {
    console.warn("Mémoire indisponible", e);
    return [];
  }
}

export async function lire<T>(magasin: Magasin, cle: string): Promise<T | undefined> {
  try {
    return (await transaction(magasin, "readonly", (s) => s.get(cle))) as T | undefined;
  } catch (e) {
    console.warn("Lecture impossible", e);
    return undefined;
  }
}

export async function ecrire(magasin: Magasin, cle: string, valeur: unknown) {
  try {
    await transaction(magasin, "readwrite", (s) => s.put(valeur, cle));
    return true;
  } catch (e) {
    console.warn("Écriture impossible", e);
    return false;
  }
}

export async function effacer(magasin: Magasin, cle?: string) {
  try {
    await transaction(magasin, "readwrite", (s) => (cle === undefined ? s.clear() : s.delete(cle)));
  } catch (e) {
    console.warn("Suppression impossible", e);
  }
}

/** Demande au navigateur de ne pas vider cette mémoire quand l'espace manque. */
export function demanderPersistance() {
  void navigator.storage?.persist?.().catch(() => undefined);
}
