# Student Planner

A student planner covering dashboard, calendar, assignment tracking, grades/GPA, notebook, study timer, exam tracker, project hub, flashcards, and study groups — with AI-assisted syllabus upload (auto-fills course info, schedule, assignments, and exams from a PDF/photo/text syllabus) and AI-generated study guides and flashcards from your notes.

No build step — plain HTML/CSS/JS, runs by opening `index.html` or serving the folder with any static file server.

## Setup

- **AI features** (syllabus parsing, flashcards, study guides): add a Claude API key in Settings → AI. Stored only in your browser's local storage.
- **Sign-in / cross-device sync**: fill in `FB_CONFIG` in `js/firebase.js` with a Firebase project (Firestore + Google sign-in enabled). Until configured, everything runs fully offline on local storage.
