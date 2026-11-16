const CATEGORIES: Record<string, string> = {
  IFCWALL: "Mur",
  IFCWALLSTANDARDCASE: "Mur",
  IFCCURTAINWALL: "Mur-rideau",
  IFCSLAB: "Dalle",
  IFCBEAM: "Poutre",
  IFCCOLUMN: "Poteau",
  IFCFOOTING: "Semelle de fondation",
  IFCPILE: "Pieu",
  IFCROOF: "Toiture",
  IFCSTAIR: "Escalier",
  IFCSTAIRFLIGHT: "Volée d'escalier",
  IFCRAMP: "Rampe",
  IFCRAMPFLIGHT: "Volée de rampe",
  IFCRAILING: "Garde-corps",
  IFCDOOR: "Porte",
  IFCWINDOW: "Fenêtre",
  IFCCOVERING: "Revêtement",
  IFCPLATE: "Panneau",
  IFCMEMBER: "Élément de structure",
  IFCBUILDINGELEMENTPROXY: "Élément générique",
  IFCBUILDINGELEMENTPART: "Partie d'élément",
  IFCELEMENTASSEMBLY: "Assemblage",
  IFCREINFORCINGBAR: "Armature",
  IFCREINFORCINGMESH: "Treillis soudé",
  IFCFURNISHINGELEMENT: "Mobilier",
  IFCFURNITURE: "Mobilier",
  IFCSPACE: "Local",
  IFCOPENINGELEMENT: "Réservation",
  IFCFLOWSEGMENT: "Conduit ou canalisation",
  IFCFLOWFITTING: "Raccord",
  IFCFLOWTERMINAL: "Terminal",
  IFCDISTRIBUTIONELEMENT: "Élément de réseau",
  IFCSANITARYTERMINAL: "Appareil sanitaire",
  IFCLIGHTFIXTURE: "Luminaire",
  IFCSITE: "Terrain",
  IFCBUILDING: "Bâtiment",
  IFCBUILDINGSTOREY: "Niveau",
  IFCGEOGRAPHICELEMENT: "Élément de site",
  IFCTRANSPORTELEMENT: "Ascenseur ou transport",
};

const ATTRIBUTS: Record<string, string> = {
  ObjectType: "Type",
  Tag: "Repère",
  Description: "Description",
  PredefinedType: "Type prédéfini",
  LongName: "Nom long",
  OverallHeight: "Hauteur hors tout",
  OverallWidth: "Largeur hors tout",
  Elevation: "Altitude",
};

export function libelleCategorie(classe: string) {
  return CATEGORIES[classe.toUpperCase()] ?? (classe || "Élément");
}

export function libelleAttribut(cle: string) {
  return ATTRIBUTS[cle] ?? cle;
}

const nombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

export function formaterValeur(v: unknown): string {
  if (typeof v === "number") return nombre.format(v);
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (v === "T" || v === ".T.") return "Oui";
  if (v === "F" || v === ".F.") return "Non";
  return String(v);
}
