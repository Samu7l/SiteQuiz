# 📝 Comment ajouter un nouvel Examen Final

Pour ajouter une nouvelle version de l'examen final à l'application, suivez ces deux étapes simples :

### Étape 1 : Ajouter le fichier de l'examen

1. Créez votre fichier `.json` contenant les questions de l'examen.
2. Placez ce fichier dans le dossier : `quizzes/final/`
   > *Exemple : `quizzes/final/final-exam-v2.json`*

### Étape 2 : Enregistrer l'examen dans `index.json`

Pour que l'application détecte ce nouveau fichier, vous devez le déclarer dans le manifeste principal.

1. Ouvrez le fichier `quizzes/index.json`.
2. Cherchez la section `"finalExams"` (c'est une liste/tableau).
3. Ajoute un nouvel objet dans la liste en suivant ce modèle :

```json
{
  "id": "identifiant-unique-v3",
  "title": "Titre affiché dans le menu",
  "file": "./final/votre-nouveau-fichier.json",
  "description": "Une courte description qui apparaitra sous le titre."
}