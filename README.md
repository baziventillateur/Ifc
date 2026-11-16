# Visionneuse IFC

Visionneuse de maquettes 3D au format IFC, utilisable dans un navigateur, sur
ordinateur comme sur téléphone. Rien à installer.

## Ce qu'elle fait

- Une **maquette d'exemple** (une école : architecture + structure) se charge à l'ouverture.
- **Ouvrir un IFC** : choisir un fichier `.ifc`, ou le glisser sur la page.
  Le fichier est lu dans le navigateur et n'est envoyé sur aucun serveur.
- **Toucher un élément** affiche sa fiche : type d'ouvrage, nom, repère,
  volume mesuré, jeux de propriétés et quantités.
- Les pastilles **Structure / Architecture** masquent ou affichent chaque maquette.
- **Recadrer** recentre la vue.

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
