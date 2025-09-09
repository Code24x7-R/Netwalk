# Netwalk Game

## 1. Introduction

Netwalk is a puzzle game where players rotate network tiles to connect a central server to all terminal nodes on a grid. The goal is to establish a complete network connection across the entire board. This application is built as a modern web experience using React and Vite.

## 2. Goals

* **Engaging Puzzle Experience:** Provide a challenging and satisfying logic puzzle for users.
* **Intuitive User Interface:** Offer a clean, responsive, and easy-to-use interface for gameplay.
* **Accessibility:** Ensure the game is playable and enjoyable for a broad audience, including keyboard navigation.
* **Scalability:** Allow for different grid sizes and game modes (e.g., wrapping edges).
* **Feedback & Immersion:** Incorporate visual and auditory feedback to enhance the user experience.

## 3. Features

* **Dynamic Grid Generation:** Randomly generated puzzles with guaranteed solutions.
* **Multiple Grid Sizes:** Players can choose between 5x5, 7x7, 9x9, and 11x11 grids.
* **Wrapping Edges Mode:** An optional mode where connections can wrap around the board edges, adding complexity.
* **Tile Rotation:** Players click or use keyboard input to rotate individual tiles.
* **Connectivity Visualization:** Tiles visually indicate their connection status to the server.
* **Win Condition Detection:** Automatically detects when all terminals are connected to the server.
* **Hint System:** Provides a hint by correctly rotating one incorrect tile, prioritizing tiles that create new connections.
* **Audio Feedback:** Distinct sounds for connecting tiles and winning the game.
* **Responsive Design:** Optimized for various screen sizes, including mobile and tablet.
* **Keyboard Navigation:** Full keyboard support for navigating and rotating tiles.

## 4. Technology Stack

* **Frontend Framework:** React (v19.1.1)
* **Build Tool:** Vite (v6.2.0)
* **Language:** TypeScript (v5.8.2)
* **Styling:** Pure CSS with CSS variables for theming.
* **Audio:** Web Audio API for in-game sound effects.
* **Deployment:** Designed for deployment on platforms like AI Studio.

## 5. Gameplay

The game presents a grid of network tiles, one of which is a central server (fixed) and several others are terminals. The player's objective is to rotate the non-server tiles until all terminals are connected to the server, forming a single, continuous network.

* **Starting a Game:** Click "New Game" to generate a fresh puzzle.
* **Rotating Tiles:** Click on any non-server tile or use arrow keys to navigate and Space/Enter to rotate the focused tile. Each click/key press rotates the tile 90 degrees clockwise.
* **Connectivity:** Connected wires and endpoints will glow with an accent color.
* **Winning:** The game is won when all terminal tiles are connected to the server. A "System Connected!" message will appear, and a celebratory animation will play.
* **Hints:** The "Hint" button will correctly rotate one tile that is currently incorrect, prioritizing a tile that will extend the connected network.

## 6. Installation & Running Locally

**Prerequisites:** Node.js (LTS recommended)

1. **Clone the repository:**
    `git clone https://github.com/Code24x7-R/Netwalk.git`
    `cd Netwalk`
2. **Install dependencies:**
    `npm install`
3. **Run the app in development mode:**
    `npm run dev`
    The application will typically be available at `http://localhost:5173` (or another port if 5173 is in use).
4. **Build for production:**
    `npm run build`
    This will create a `dist` directory with the optimized production build.

## 7. License
