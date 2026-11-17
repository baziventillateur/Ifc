# Visionneuse IFC

Visionneuse de maquettes 3D au format IFC, utilisable dans un navigateur, sur
ordinateur comme sur téléphone. Rien à installer.

## Ce qu'elle fait

- Une **maquette d'exemple** (une école : architecture + structure) se charge à l'ouverture.
- **+ Maquette** : ajouter un ou plusieurs fichiers `.ifc` (sélection multiple,
  ou glisser-déposer sur la page). Les maquettes s'ajoutent les unes aux autres
  et se superposent dans le repère du projet (structure, CVC, plomberie…).
  Les fichiers sont lus dans le navigateur et ne sont envoyés sur aucun serveur.
- Le panneau **Maquettes** liste les maquettes chargées :
  toucher un nom l'affiche ou la masque, ◎ n'affiche qu'elle, ✕ la retire.
  *Tout afficher* et *Tout retirer* agissent sur l'ensemble. Le titre du panneau le replie.
- **Toucher un élément** affiche sa fiche : maquette d'origine, type d'ouvrage,
  nom, repère, volume mesuré, jeux de propriétés et quantités.
- **Recadrer** recentre la vue sur les maquettes visibles.

Depuis Revit, exporter la maquette avec *Fichier → Exporter → IFC* : le format
`.rvt` n'est pas lisible directement.

## Limites connues

- Les très grosses maquettes (plusieurs centaines de Mo) sont lentes à convertir sur téléphone.
- Les noms des propriétés s'affichent dans la langue du logiciel qui a produit l'IFC.

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
