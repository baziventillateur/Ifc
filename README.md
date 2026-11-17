# Visionneuse IFC

Visionneuse de maquettes 3D au format IFC, utilisable dans un navigateur, sur
ordinateur comme sur téléphone. Rien à installer.

## Ce qu'elle fait

### Maquettes
- **+ Maquette** : ajouter un ou plusieurs fichiers `.ifc` (sélection multiple, ou
  glisser-déposer). Les maquettes se superposent dans le repère du projet.
  Les fichiers sont lus dans le navigateur et ne sont envoyés sur aucun serveur.
- Les maquettes converties sont **gardées sur l'appareil** (IndexedDB) : elles se
  rouvrent toutes seules à la visite suivante, sans reconversion. ✕ les retire aussi
  de la mémoire.
- Panneau **Maquettes** : toucher un nom l'affiche ou la masque, ◐ la rend
  transparente (on touche à travers), ◎ n'affiche qu'elle, ✕ la retire.
  **Couleurs par lot** colore chaque maquette selon son lot, reconnu dans le nom
  du fichier (STR, ARC, CVC, PB, ELEC, SPK, VRD…).
- **Toucher un élément** ouvre sa fiche (maquette, classe IFC, niveau, volume,
  propriétés et quantités) avec **Centrer**, **Isoler** et **+ Remarque**.

### Outils (barre sous l'en-tête)
- **Coupe** : coupe horizontale (curseur ou bouton par niveau, à 1,20 m du sol) et
  coupe verticale selon X ou Y. Les cotes affichées sont celles du projet.
- **Mesure** : distance entre deux points touchés, accrochée aux sommets et arêtes,
  avec les composantes horizontale et verticale.
- **Filtres** : afficher ou masquer par niveau et par type d'élément.
  Double-toucher un nom n'affiche que lui.
- **Recherche** : par nom, type, niveau ou propriété (`loadbearing:oui`,
  `niveau:r+1`, `nom:gaine`…). Raccourcis : porteurs, extérieurs, coupe-feu.
  Résultats surlignés, isolables, et cliquables pour zoomer.
- **Quantités** : nombre, volume (m³), surface (m²) et longueur (m) par type ou
  par niveau. Les quantités viennent de l'IFC ; le volume est mesuré sur la
  géométrie quand l'IFC ne le donne pas. Export CSV pour Excel.
- **Clashs** : maquette A contre maquette B (par défaut un réseau contre la
  structure), avec une tolérance en cm. Tri par boîtes englobantes puis contrôle
  précis sur la géométrie réelle. Chaque conflit s'affiche en rouge et vert sur
  fond fantôme, avec un statut (à traiter, accepté, résolu), une remarque BCF
  en un geste, et un export CSV (avec GUID et coordonnées du projet).
- **Remarques** : remarques posées sur la vue et les éléments sélectionnés, avec
  vignette. Export et import au format **BCF 2.1**, lisible par Revit
  (BCF Manager), BIMcollab, Navisworks ou Solibri.
- **IA** : assistant Claude qui répond en français sur les maquettes chargées
  (quantités, recherche, affichage, clashs avec propositions de solutions).
  Il faut une clé API Anthropic, gardée dans le navigateur. Les fichiers IFC ne
  sont pas envoyés : l'assistant appelle des outils qui s'exécutent dans la page
  et ne reçoit que leurs réponses.

Depuis Revit, exporter la maquette avec *Fichier → Exporter → IFC* : le format
`.rvt` n'est pas lisible directement. Toutes les maquettes d'un projet doivent
être exportées avec les mêmes coordonnées partagées pour se superposer.

## Limites connues

- Les très grosses maquettes (plusieurs centaines de Mo) sont lentes à convertir sur téléphone.
- Les noms des propriétés s'affichent dans la langue du logiciel qui a produit l'IFC.
- Les remarques ne sont partagées que par fichier BCF (pas encore de partage en ligne).
- La détection des clashs ne tient pas compte des coupes ni des filtres : elle
  porte sur toute la maquette A et toute la maquette B.

## Développement

```bash
npm install
npm run dev      # version locale
npm run build    # site prêt à publier dans dist/
```

Chaque envoi sur la branche `main` reconstruit le site et le publie sur la
branche `gh-pages` (voir `.github/workflows/publier.yml`).

## Briques utilisées

Voir [CREDITS.md](CREDITS.md).
