
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// --- TYPES AND CONSTANTS ---

enum TileType {
    TERMINAL, STRAIGHT, CORNER, T_JUNCTION, CROSS
}

interface Tile {
    type: TileType;
    rotation: number; // 0: 0deg, 1: 90deg, 2: 180deg, 3: 270deg
    connected: boolean;
    isServer: boolean;
}

type Grid = Tile[][];
type Coords = { r: number; c: number };
type ScoreEntry = { initials: string; score: number; gridSize: number; isWrapping: boolean; };

const DIRECTIONS = {
    N: { r: -1, c: 0, from: 'S', mask: 1 },
    E: { r: 0, c: 1, from: 'W', mask: 2 },
    S: { r: 1, c: 0, from: 'N', mask: 4 },
    W: { r: 0, c: -1, from: 'E', mask: 8 },
};

const TILE_CONNECTIONS: Record<TileType, number[]> = {
    [TileType.TERMINAL]: [1, 2, 4, 8],
    [TileType.STRAIGHT]: [5, 10, 5, 10],
    [TileType.CORNER]: [3, 6, 12, 9],
    [TileType.T_JUNCTION]: [7, 14, 13, 11],
    [TileType.CROSS]: [15, 15, 15, 15],
};


// --- SVG COMPONENTS ---

const SpeakerOnIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v8.05a4.5 4.5 0 0 0 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
    </svg>
);

const SpeakerOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.998 12.513c.481-1.002.724-2.09.724-3.234 0-4.01-2.61-7.31-6.222-8.525l-1.474 1.474c2.812.986 4.696 3.696 4.696 6.775 0 .613-.08 1.21-.23 1.776l1.506 1.506zM23 12c0 1.95-.55 3.78-1.52 5.38l-1.42-1.42C20.69 14.86 21 13.48 21 12c0-4.97-3.23-9.1-7.5-10.43v1.64c3.39.89 6 3.96 6 7.51zM4.27 3L3 4.27l6.01 6.01L5 15v-6H1v8h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v1.64c1.54-.31 2.94-1.03 4.14-2.02L19.73 21 21 19.73 4.27 3zM9 9.27L14.73 15H9V9.27z" />
    </svg>
);

const TileIcon = ({ type, connected, isServer }: { type: TileType, connected: boolean, isServer: boolean }) => {
    const classNames = `wire ${connected ? 'connected' : ''}`;
    let baseWires = null;

    switch (type) {
        case TileType.TERMINAL:
            baseWires = <>
                <rect x="25" y="25" width="50" height="50" rx="5" className={`endpoint ${connected ? 'connected' : ''}`} />
                <line x1="50" y1="25" x2="50" y2="0" className={classNames} />
            </>;
            break;
        case TileType.STRAIGHT:
            baseWires = <line x1="50" y1="0" x2="50" y2="100" className={classNames} />;
            break;
        case TileType.CORNER:
            baseWires = <>
                <line x1="50" y1="0" x2="50" y2="50" className={classNames} />
                <line x1="50" y1="50" x2="100" y2="50" className={classNames} />
            </>;
            break;
        case TileType.T_JUNCTION:
            baseWires = <>
                <line x1="50" y1="0" x2="50" y2="100" className={classNames} />
                <line x1="50" y1="50" x2="100" y2="50" className={classNames} />
            </>;
            break;
        case TileType.CROSS:
            baseWires = <>
                <line x1="50" y1="0" x2="50" y2="100" className={classNames} />
                <line x1="0" y1="50" x2="100" y2="50" className={classNames} />
            </>;
            break;
    }

    if (isServer) {
        return <>
            {baseWires}
            <rect width="50" height="50" x="25" y="25" className="server" rx="5" />
        </>;
    }

    return baseWires;
};

// --- AUDIO UTILITIES ---

const startBackgroundMusic = (audioCtx: AudioContext): { gainNode: GainNode; stop: () => void; } => {
    const musicGain = audioCtx.createGain();
    musicGain.gain.setValueAtTime(0, audioCtx.currentTime); // Start silent
    musicGain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 1); // Fade in
    musicGain.connect(audioCtx.destination);

    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();

    osc.type = 'sawtooth';
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, audioCtx.currentTime);
    filter.Q.setValueAtTime(2, audioCtx.currentTime);

    osc.connect(filter);
    filter.connect(musicGain);

    const notes = [110.00, 130.81, 146.83, 110.00, 164.81, 130.81, 110.00, 98.00]; // A2, C3, D3, A2, E3, C3, A2, G2
    let noteIndex = 0;
    const noteDuration = 0.4;
    let nextNoteTime = audioCtx.currentTime;
    let timerId: number;

    const scheduleNotes = () => {
        while (nextNoteTime < audioCtx.currentTime + 0.1) {
            const freq = notes[noteIndex % notes.length];
            osc.frequency.setValueAtTime(freq, nextNoteTime);
            noteIndex++;
            nextNoteTime += noteDuration;
        }
        timerId = window.setTimeout(scheduleNotes, 50);
    };

    osc.start();
    scheduleNotes();
    
    const stop = () => {
        clearTimeout(timerId);
        const now = audioCtx.currentTime;
        musicGain.gain.cancelScheduledValues(now);
        musicGain.gain.setTargetAtTime(0, now, 0.5); // Fade out
        osc.stop(now + 0.6);
        setTimeout(() => {
            osc.disconnect();
            musicGain.disconnect();
            filter.disconnect();
        }, 600);
    };

    return { gainNode: musicGain, stop };
};

const playConnectSound = (audioCtx: AudioContext, count: number) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(100 + count * 5, audioCtx.currentTime);

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.2);
};

const playWinSound = (audioCtx: AudioContext) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    const lfo = audioCtx.createOscillator(); // For vibrato
    const vibratoGain = audioCtx.createGain(); // To control vibrato depth

    // Vibrato setup
    lfo.frequency.setValueAtTime(5, audioCtx.currentTime); // 5 Hz vibrato
    vibratoGain.gain.setValueAtTime(5, audioCtx.currentTime); // 5 cents of detune
    lfo.connect(vibratoGain);
    vibratoGain.connect(osc.detune);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'triangle';
    const now = audioCtx.currentTime;

    const notes = [
        261.63, // C4
        329.63, // E4
        392.00, // G4
        523.25, // C5
        659.25, // E5
        783.99, // G5
        1046.50, // C6
        783.99, // G5
        523.25, // C5
        392.00, // G4
        261.63, // C4
    ];
    const noteDuration = 0.1;
    const totalDuration = notes.length * noteDuration;

    gainNode.gain.setValueAtTime(0.5, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + totalDuration);

    notes.forEach((freq, i) => {
        osc.frequency.setValueAtTime(freq, now + i * noteDuration);
    });

    lfo.start(now);
    osc.start(now);

    lfo.stop(now + totalDuration + 0.1);
    osc.stop(now + totalDuration + 0.1);
};

const playHintSound = (audioCtx: AudioContext) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'sine';
    const now = audioCtx.currentTime;
    
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);

    osc.start(now);
    osc.stop(now + 0.4);
};

const playRotateSound = (audioCtx: AudioContext) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'triangle';
    const now = audioCtx.currentTime;
    
    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    
    osc.frequency.setValueAtTime(150, now);

    osc.start(now);
    osc.stop(now + 0.1);
};


// --- GAME LOGIC UTILITIES ---

const generateGrid = (size: number, isWrapping: boolean): [Grid, number[][], Coords, Coords[]] => {
    // 1. Create a spanning tree covering all cells to guarantee a single, fully connected network
    const connections: number[][] = Array(size).fill(0).map(() => Array(size).fill(0));
    const visited: boolean[][] = Array(size).fill(false).map(() => Array(size).fill(false));
    
    const startR = Math.floor(Math.random() * size);
    const startC = Math.floor(Math.random() * size);
    const stack: Coords[] = [{ r: startR, c: startC }];
    visited[startR][startC] = true;

    while (stack.length > 0) {
        const { r, c } = stack[stack.length - 1];
        const neighbors = [];
        for (const key in DIRECTIONS) {
            const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
            let nr = r + dir.r;
            let nc = c + dir.c;

            if (isWrapping) {
                nr = (nr + size) % size;
                nc = (nc + size) % size;
            }

            if ((isWrapping || (nr >= 0 && nr < size && nc >= 0 && nc < size)) && !visited[nr][nc]) {
                neighbors.push({ r: nr, c: nc, mask: dir.mask, fromMask: DIRECTIONS[dir.from as keyof typeof DIRECTIONS].mask });
            }
        }

        if (neighbors.length > 0) {
            const neighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
            connections[r][c] |= neighbor.mask;
            connections[neighbor.r][neighbor.c] |= neighbor.fromMask;
            visited[neighbor.r][neighbor.c] = true;
            stack.push({ r: neighbor.r, c: neighbor.c });
        } else {
            stack.pop();
        }
    }

    // 1.5. Add extra connections to create cycles and more complex tiles (T-junctions, crosses)
    const extraConnections = Math.floor(size * size * 0.4); // Increased density
    for (let i = 0; i < extraConnections; i++) {
        const r = Math.floor(Math.random() * size);
        const c = Math.floor(Math.random() * size);

        const potentialDirections = [];
        for (const key in DIRECTIONS) {
            const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
            // Check if connection doesn't already exist
            if ((connections[r][c] & dir.mask) === 0) {
                potentialDirections.push(dir);
            }
        }
        
        if (potentialDirections.length > 0) {
            const dir = potentialDirections[Math.floor(Math.random() * potentialDirections.length)];
            let nr = r + dir.r;
            let nc = c + dir.c;

            if (isWrapping) {
                nr = (nr + size) % size;
                nc = (nc + size) % size;
            }

            // Add connection if neighbor is within bounds (for non-wrapping)
            if (isWrapping || (nr >= 0 && nr < size && nc >= 0 && nc < size)) {
                 connections[r][c] |= dir.mask;
                 connections[nr][nc] |= DIRECTIONS[dir.from as keyof typeof DIRECTIONS].mask;
            }
        }
    }

    // 2. Determine tile types based on the connections, and identify terminals
    const terminals: Coords[] = [];
    const solvedGrid: Omit<Tile, 'connected' | 'isServer'>[][] = connections.map((row, r) => row.map((conn, c) => {
        const numConnections = conn.toString(2).split('1').length - 1;
        let type: TileType;

        if (numConnections === 1) {
            type = TileType.TERMINAL;
            terminals.push({ r, c });
        } else {
            switch (numConnections) {
                case 2: type = (conn === 5 || conn === 10) ? TileType.STRAIGHT : TileType.CORNER; break;
                case 3: type = TileType.T_JUNCTION; break;
                case 4: type = TileType.CROSS; break;
                default: type = TileType.TERMINAL; // Should not happen
            }
        }

        const targetRotations = TILE_CONNECTIONS[type];
        let rotation = targetRotations.indexOf(conn);
        if (rotation === -1) rotation = 0;

        return { type, rotation };
    }));
    
    // 3. Select a server from any location
    const allCoords: Coords[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            allCoords.push({ r, c });
        }
    }
    const serverCoords = allCoords[Math.floor(Math.random() * allCoords.length)];

    const solutionRotations = solvedGrid.map(row => row.map(tile => tile.rotation));

    // 4. Scramble the grid, keeping only the server fixed in its solved rotation
    const finalGrid: Grid = solvedGrid.map((row, r) => row.map((tile, c) => {
        const isThisServer = r === serverCoords.r && c === serverCoords.c;

        return {
            ...tile,
            isServer: isThisServer,
            rotation: isThisServer ? tile.rotation : Math.floor(Math.random() * 4),
            connected: false,
        };
    }));


    return [finalGrid, solutionRotations, serverCoords, terminals];
};

const checkConnectivity = (grid: Grid, serverCoords: Coords, isWrapping: boolean): Grid => {
    const size = grid.length;
    const connectedSet = new Set<string>();
    const queue: Coords[] = [serverCoords];
    const visited = new Set<string>([`${serverCoords.r},${serverCoords.c}`]);

    while (queue.length > 0) {
        const { r, c } = queue.shift()!;
        connectedSet.add(`${r},${c}`);

        const tile = grid[r][c];
        const connections = TILE_CONNECTIONS[tile.type][tile.rotation];

        for (const key in DIRECTIONS) {
            const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
            if ((connections & dir.mask) !== 0) {
                let nr = r + dir.r;
                let nc = c + dir.c;

                if (isWrapping) {
                    nr = (nr + size) % size;
                    nc = (nc + size) % size;
                }

                if ((isWrapping || (nr >= 0 && nr < size && nc >= 0 && nc < size)) && !visited.has(`${nr},${nc}`)) {
                    const neighbor = grid[nr][nc];
                    const neighborConnections = TILE_CONNECTIONS[neighbor.type][neighbor.rotation];
                    if ((neighborConnections & DIRECTIONS[dir.from as keyof typeof DIRECTIONS].mask) !== 0) {
                        visited.add(`${nr},${nc}`);
                        queue.push({ r: nr, c: nc });
                    }
                }
            }
        }
    }

    return grid.map((row, r) => row.map((tile, c) => ({
        ...tile,
        connected: connectedSet.has(`${r},${c}`),
    })));
};

// --- MAIN APP COMPONENT ---

const App = () => {
    const [gridSize, setGridSize] = useState(7);
    const [isWrapping, setIsWrapping] = useState(false);
    const [grid, setGrid] = useState<Grid>([]);
    const [solution, setSolution] = useState<number[][]>([]);
    const [serverCoords, setServerCoords] = useState<Coords>({ r: 0, c: 0 });
    const [terminals, setTerminals] = useState<Coords[]>([]);
    const [isWon, setIsWon] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const [hintedTile, setHintedTile] = useState<Coords | null>(null);
    const [focusedTile, setFocusedTile] = useState<Coords | null>({ r: 0, c: 0 });
    const [distanceMap, setDistanceMap] = useState<number[][]>([]);
    const [score, setScore] = useState(0);
    const [finalScoreInfo, setFinalScoreInfo] = useState<{ score: number; bonus: number } | null>(null);
    const startTimeRef = useRef<number>(0);
    const [isMuted, setIsMuted] = useState(true);
    const musicNodesRef = useRef<{ gainNode: GainNode; stop: () => void; } | null>(null);

    const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [isHighScore, setIsHighScore] = useState(false);
    const [playerInitials, setPlayerInitials] = useState("");

    // Load leaderboard from local storage on initial render
    useEffect(() => {
        try {
            const savedScores = localStorage.getItem('netwalkLeaderboard');
            if (savedScores) {
                setLeaderboard(JSON.parse(savedScores));
            }
        } catch (error) {
            console.error("Failed to load leaderboard from localStorage:", error);
        }
    }, []);

    const getAndResumeAudioContext = useCallback(() => {
        let isNewContext = false;
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                isNewContext = true;
            } catch (e) {
                console.error("Web Audio API is not supported in this browser");
                return null;
            }
        }
        
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().catch(e => console.error("Audio context resume failed:", e));
        }
        
        // Auto-play music on first interaction if not muted
        if ((isNewContext || audioContextRef.current.state === 'running') && !isMuted && !musicNodesRef.current) {
            musicNodesRef.current = startBackgroundMusic(audioContextRef.current);
        }

        return audioContextRef.current;
    }, [isMuted]);

    // Effect to control music when mute state changes
    useEffect(() => {
        const audioCtx = audioContextRef.current;
        if (isMuted) {
            if (musicNodesRef.current) {
                musicNodesRef.current.stop();
                musicNodesRef.current = null;
            }
        } else {
            // Only start music if context exists and is running
            if (audioCtx && audioCtx.state === 'running' && !musicNodesRef.current) {
                musicNodesRef.current = startBackgroundMusic(audioCtx);
            }
        }

        // Cleanup on component unmount
        return () => {
            if (musicNodesRef.current) {
                musicNodesRef.current.stop();
                musicNodesRef.current = null;
            }
        };
    }, [isMuted]);

    const handleMuteToggle = () => {
        // This ensures the audio context is active before we try to play/stop music
        getAndResumeAudioContext();
        setIsMuted(prev => !prev);
    };

    const startNewGame = useCallback(() => {
        setIsWon(false);
        setDistanceMap([]);
        setFocusedTile({ r: Math.floor(gridSize/2), c: Math.floor(gridSize/2) });
        setScore(gridSize * gridSize * 100);
        setFinalScoreInfo(null);
        setIsHighScore(false);
        setPlayerInitials("");
        startTimeRef.current = Date.now();
        const [newGrid, newSolution, newServerCoords, newTerminals] = generateGrid(gridSize, isWrapping);
        setServerCoords(newServerCoords);
        setTerminals(newTerminals);
        setSolution(newSolution);
        const updatedGrid = checkConnectivity(newGrid, newServerCoords, isWrapping);
        setGrid(updatedGrid);
    }, [gridSize, isWrapping]);

    useEffect(() => {
        startNewGame();
    }, [startNewGame]);

    const rotateTile = useCallback((r: number, c: number) => {
        const tile = grid[r]?.[c];
        if (!tile || isWon || tile.isServer) return;

        setScore(prev => prev - 10);

        const currentAudioContext = getAndResumeAudioContext();

        if (currentAudioContext) {
            playRotateSound(currentAudioContext);
        }

        const previouslyConnectedCount = grid.flat().filter(t => t.connected).length;

        const newGrid = grid.map(row => row.map(cell => ({ ...cell })));
        newGrid[r][c].rotation = (newGrid[r][c].rotation + 1) % 4;

        const updatedGridWithConnectivity = checkConnectivity(newGrid, serverCoords, isWrapping);
        
        if (currentAudioContext) {
            const newlyConnectedCount = updatedGridWithConnectivity.flat().filter(t => t.connected).length;
            const newConnections = newlyConnectedCount - previouslyConnectedCount;
            if (newConnections > 0) {
                playConnectSound(currentAudioContext, newConnections);
            }
        }
        
        setGrid(updatedGridWithConnectivity);
    }, [grid, isWon, serverCoords, isWrapping, getAndResumeAudioContext]);

    // Check for win condition whenever the grid changes
    useEffect(() => {
        if (isWon || grid.length === 0) return;

        const isWinConditionMet = () => {
            const size = grid.length;
            
            // Condition 1: All required tiles must be connected.
            // If terminals exist, all must be connected. If not, every tile must be.
            const allRequiredTilesConnected = terminals.length > 0
                ? terminals.every(t => grid[t.r]?.[t.c]?.connected)
                : grid.flat().every(t => t.connected);

            if (!allRequiredTilesConnected) {
                return false;
            }

            // Condition 2: The connected network must have zero "leaks".
            // A leak is a connection on a powered tile that points to a non-powered
            // tile, a misaligned tile, or off the board.
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    const tile = grid[r][c];

                    // Only check for leaks from powered tiles.
                    if (!tile.connected) continue;

                    const connections = TILE_CONNECTIONS[tile.type][tile.rotation];

                    for (const key in DIRECTIONS) {
                        const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];

                        // If this tile has a connection pointing in a direction...
                        if ((connections & dir.mask) !== 0) {
                            let nr = r + dir.r;
                            let nc = c + dir.c;

                            // Case 1: Leak off the edge in non-wrapping mode
                            if (!isWrapping && (nr < 0 || nr >= size || nc < 0 || nc >= size)) {
                                return false; // Leak found.
                            }

                            if (isWrapping) {
                                nr = (nr + size) % size;
                                nc = (nc + size) % size;
                            }
                            
                            const neighbor = grid[nr][nc];
                            
                            // Case 2: Leak to an unpowered tile.
                            if (!neighbor.connected) {
                                return false; // Leak found.
                            }

                            // Case 3: Leak to a powered tile that isn't pointing back.
                            const neighborConnections = TILE_CONNECTIONS[neighbor.type][neighbor.rotation];
                            const fromMask = DIRECTIONS[dir.from as keyof typeof DIRECTIONS].mask;
                            if ((neighborConnections & fromMask) === 0) {
                                return false; // Leak found.
                            }
                        }
                    }
                }
            }
            
            return true; // All checks passed.
        };


        if (isWinConditionMet()) {
            const endTime = Date.now();
            const duration = (endTime - startTimeRef.current) / 1000;
            const parTime = gridSize * gridSize * 2; // 2 seconds per tile "par" time
            const timeBonus = Math.max(0, Math.floor((parTime - duration) * 10)); // 10 points per second under par
            const final = score + timeBonus;
            setFinalScoreInfo({ score: final, bonus: timeBonus });

            const isTopTen = leaderboard.length < 10 || final > leaderboard[leaderboard.length - 1].score;
            setIsHighScore(isTopTen);

            setIsWon(true);
            const currentAudioContext = getAndResumeAudioContext();
            if (currentAudioContext) {
                playWinSound(currentAudioContext);
            }
            
            // Calculate distance map for win animation cascade
            const size = grid.length;
            const newDistanceMap = Array(size).fill(0).map(() => Array(size).fill(-1));
            const queue: Array<{ r: number, c: number, dist: number }> = [{ r: serverCoords.r, c: serverCoords.c, dist: 0 }];
            const visitedForDist = new Set<string>([`${serverCoords.r},${serverCoords.c}`]);
            newDistanceMap[serverCoords.r][serverCoords.c] = 0;

            let head = 0;
            while (head < queue.length) {
                const { r: qr, c: qc, dist } = queue[head++];
                const tile = grid[qr][qc];
                const connections = TILE_CONNECTIONS[tile.type][tile.rotation];

                for (const key in DIRECTIONS) {
                    const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
                    if ((connections & dir.mask) !== 0) {
                        let nr = qr + dir.r;
                        let nc = qc + dir.c;

                        if (isWrapping) {
                            nr = (nr + size) % size;
                            nc = (nc + size) % size;
                        }
                        
                        const neighborKey = `${nr},${nc}`;
                        if ((isWrapping || (nr >= 0 && nr < size && nc >= 0 && nc < size)) && !visitedForDist.has(neighborKey)) {
                             const neighbor = grid[nr][nc];
                             if (neighbor.connected) {
                                visitedForDist.add(neighborKey);
                                newDistanceMap[nr][nc] = dist + 1;
                                queue.push({ r: nr, c: nc, dist: dist + 1 });
                             }
                        }
                    }
                }
            }
            setDistanceMap(newDistanceMap);
        }
    }, [grid, terminals, isWon, serverCoords, isWrapping, score, gridSize, leaderboard, getAndResumeAudioContext]);

    const handleTileClick = (r: number, c: number) => {
        setFocusedTile({ r, c });
        rotateTile(r, c);
    };

    const handleInitialsSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!playerInitials.trim() || !finalScoreInfo) return;

        const newScore: ScoreEntry = {
            initials: playerInitials.trim().toUpperCase(),
            score: finalScoreInfo.score,
            gridSize: gridSize,
            isWrapping: isWrapping,
        };
        
        setLeaderboard(prevLeaderboard => {
            const newLeaderboard = [...prevLeaderboard, newScore]
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);
            
            try {
                localStorage.setItem('netwalkLeaderboard', JSON.stringify(newLeaderboard));
            } catch (error) {
                console.error("Failed to save leaderboard to localStorage:", error);
            }
            
            return newLeaderboard;
        });
        
        setIsHighScore(false); // Hide the form after submission
    };

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!focusedTile || isWon) return;

            let { r, c } = focusedTile;

            switch (e.key) {
                case 'ArrowUp':
                    r = isWrapping ? (r - 1 + gridSize) % gridSize : Math.max(0, r - 1);
                    break;
                case 'ArrowDown':
                    r = isWrapping ? (r + 1) % gridSize : Math.min(gridSize - 1, r + 1);
                    break;
                case 'ArrowLeft':
                    c = isWrapping ? (c - 1 + gridSize) % gridSize : Math.max(0, c - 1);
                    break;
                case 'ArrowRight':
                    c = isWrapping ? (c + 1) % gridSize : Math.min(gridSize - 1, c + 1);
                    break;
                case ' ': // Spacebar
                case 'Enter':
                    e.preventDefault();
                    rotateTile(r, c);
                    return; // Return early to avoid setting state again
                default:
                    return; // Ignore other keys
            }
            e.preventDefault();
            setFocusedTile({ r, c });
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedTile, gridSize, isWrapping, rotateTile, isWon]);


    const handleHintClick = () => {
        if (isWon) return;
        
        setScore(prev => prev - 250);

        const currentAudioContext = getAndResumeAudioContext();
       
        const incorrectTiles: Coords[] = [];
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                if (!grid[r][c].isServer && grid[r][c].rotation !== solution[r][c]) {
                    incorrectTiles.push({ r, c });
                }
            }
        }

        if (incorrectTiles.length === 0) return;

        let bestHint: { coords: Coords | null, maxNewConnections: number } = { coords: null, maxNewConnections: -1 };
        const previouslyConnectedCount = grid.flat().filter(t => t.connected).length;

        for (const coords of incorrectTiles) {
            const tempGrid = grid.map(row => row.map(cell => ({ ...cell })));
            tempGrid[coords.r][coords.c].rotation = solution[coords.r][coords.c];
            
            const gridAfterHint = checkConnectivity(tempGrid, serverCoords, isWrapping);
            const newlyConnectedCount = gridAfterHint.flat().filter(t => t.connected).length;
            const newConnections = newlyConnectedCount - previouslyConnectedCount;

            if (newConnections > bestHint.maxNewConnections) {
                bestHint = { coords, maxNewConnections: newConnections };
            }
        }
        
        // Fallback: If no rotation provides new connections, find one adjacent to the current network
        if (bestHint.coords === null || bestHint.maxNewConnections <= 0) {
            let adjacentHint: Coords | null = null;
            for (const { r, c } of incorrectTiles) {
                let isAdjacent = false;
                for (const key in DIRECTIONS) {
                    const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
                    let nr = r + dir.r;
                    let nc = c + dir.c;
                    if (isWrapping) {
                        nr = (nr + gridSize) % gridSize;
                        nc = (nc + gridSize) % gridSize;
                    }
                    if ((isWrapping || (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize)) && grid[nr][nc].connected) {
                        isAdjacent = true;
                        break;
                    }
                }
                if (isAdjacent) {
                    adjacentHint = { r, c };
                    break;
                }
            }
            bestHint.coords = adjacentHint || incorrectTiles[0];
        }
        
        const hintCoords = bestHint.coords;

        if (hintCoords) {
            if (currentAudioContext) { playHintSound(currentAudioContext); }
            const { r, c } = hintCoords;
            const newGrid = grid.map(row => row.map(cell => ({ ...cell })));
            newGrid[r][c].rotation = solution[r][c];
            
            const updatedGrid = checkConnectivity(newGrid, serverCoords, isWrapping);
            setGrid(updatedGrid);
            setHintedTile({ r, c });
            setTimeout(() => setHintedTile(null), 1000);
        }
    };

    return (
        <div className="app-container">
            <header className="header">
                <h1 className="title">Netwalk</h1>
                <div className="score-display">Score: {score}</div>
                 <button 
                    className="mute-button" 
                    onClick={handleMuteToggle}
                    aria-label={isMuted ? "Unmute music" : "Mute music"}
                >
                    {isMuted ? <SpeakerOffIcon /> : <SpeakerOnIcon />}
                </button>
            </header>
            <div className="controls">
                <button className="control-button" onClick={startNewGame}>New Game</button>
                <button className="control-button" onClick={() => setShowLeaderboard(true)}>Leaderboard</button>
                <button className="control-button" onClick={handleHintClick} disabled={isWon}>Hint</button>
                <select 
                    className="control-select"
                    value={gridSize}
                    onChange={(e) => setGridSize(Number(e.target.value))}
                    aria-label="Grid Size"
                >
                    <option value="5">5 x 5</option>
                    <option value="7">7 x 7</option>
                    <option value="9">9 x 9</option>
                    <option value="11">11 x 11</option>
                </select>
                <div className="control-toggle">
                    <input 
                        type="checkbox" 
                        id="wrapping-toggle" 
                        className="wrapping-checkbox"
                        checked={isWrapping} 
                        onChange={(e) => setIsWrapping(e.target.checked)} 
                    />
                    <label htmlFor="wrapping-toggle" className="wrapping-label">Wrap Edges</label>
                </div>
            </div>
            <div className="game-container">
                <div 
                    className={`game-board ${isWon ? 'game-won' : ''}`}
                    style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}
                >
                    {grid.map((row, r) =>
                        row.map((tile, c) => (
                            <div
                                key={`${r}-${c}`}
                                className={`tile ${tile.isServer ? 'fixed' : ''} ${hintedTile && hintedTile.r === r && hintedTile.c === c ? 'hinted' : ''} ${focusedTile && focusedTile.r === r && focusedTile.c === c ? 'focused' : ''}`}
                                onClick={() => handleTileClick(r, c)}
                                role="button"
                                tabIndex={isWon ? -1 : 0}
                                aria-label={`Tile at row ${r+1}, column ${c+1}. Type: ${TileType[tile.type]}. Press to rotate.`}
                                style={isWon && distanceMap[r]?.[c] > -1 ? { '--animation-delay': `${distanceMap[r][c] * 50}ms` } as React.CSSProperties : undefined}
                            >
                                <svg
                                    className="tile-svg"
                                    viewBox="0 0 100 100"
                                    style={{ transform: `rotate(${tile.rotation * 90}deg)` }}
                                >
                                    <TileIcon 
                                        type={tile.type} 
                                        connected={tile.connected}
                                        isServer={tile.isServer}
                                    />
                                </svg>
                            </div>
                        ))
                    )}
                </div>
                <div className={`win-message ${isWon ? 'visible' : ''}`}>
                    <p className="win-title">System Connected!</p>
                    {finalScoreInfo && (
                        isHighScore ? (
                            <form className="highscore-form" onSubmit={handleInitialsSubmit}>
                                <p className="highscore-prompt">New High Score!</p>
                                <label htmlFor="initials-input" className="sr-only">Enter your initials</label>
                                <input
                                    id="initials-input"
                                    type="text"
                                    className="highscore-input"
                                    value={playerInitials}
                                    onChange={(e) => setPlayerInitials(e.target.value)}
                                    maxLength={3}
                                    placeholder="AAA"
                                    required
                                    autoFocus
                                />
                                <button type="submit" className="highscore-submit-button">Save Score</button>
                            </form>
                        ) : (
                            <>
                                <p className="final-score">Final Score: {finalScoreInfo.score}</p>
                                {finalScoreInfo.bonus > 0 && (
                                    <p className="score-breakdown">(Time Bonus: +{finalScoreInfo.bonus})</p>
                                )}
                            </>
                        )
                    )}
                </div>
            </div>

            {showLeaderboard && (
                <div className="leaderboard-overlay" onClick={() => setShowLeaderboard(false)}>
                    <div className="leaderboard-modal" onClick={(e) => e.stopPropagation()}>
                        <h2 className="leaderboard-title">Top 10 Scores</h2>
                        {leaderboard.length > 0 ? (
                            <ol className="leaderboard-list">
                                {leaderboard.map((entry, index) => (
                                    <li key={index} className="leaderboard-item">
                                        <span className="leaderboard-rank">{index + 1}.</span>
                                        <span className="leaderboard-initials">{entry.initials}</span>
                                        <span className="leaderboard-map">
                                            {entry.gridSize ? `${entry.gridSize}x${entry.gridSize}${entry.isWrapping ? ' Wrap' : ''}` : '-'}
                                        </span>
                                        <span className="leaderboard-score">{entry.score}</span>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <p className="leaderboard-empty">No scores yet. Be the first!</p>
                        )}
                        <button className="control-button leaderboard-close" onClick={() => setShowLeaderboard(false)}>Close</button>
                    </div>
                </div>
            )}
        </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
