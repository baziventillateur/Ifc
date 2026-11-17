// Événements entre outils (évite les dépendances croisées entre modules).
import { Signal } from "./noyau";

export type DemandeRemarque = {
  titre?: string;
  description?: string;
  type?: "Remarque" | "Clash" | "Question";
  elements: { modele: string; id: number }[];
};

/** Un outil demande la création d'une remarque (fiche d'élément, clash…). */
export const demandeRemarque = new Signal<DemandeRemarque>();

/** Un outil demande l'ouverture d'un autre outil. */
export const demandeOutil = new Signal<string>();
