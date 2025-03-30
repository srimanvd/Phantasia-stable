import { useEffect, useState, useRef } from 'react';

interface Equation {
  id: string;
  expression: string;
  label?: string;
  color?: string;
  timestamp: string;
}

// Define window.Desmos type for TypeScript
declare global {
  interface Window {
    Desmos: {
      GraphingCalculator: (
        element: HTMLElement,
        options?: {
          keypad?: boolean;
          expressions?: boolean;
          settingsMenu?: boolean;
          zoomButtons?: boolean;
          invertedColors?: boolean;
          backgroundColor?: string;
        }
      ) => {
        destroy: () => void;
        setExpression: (options: { id: string; latex: string; color?: string; label?: string }) => void;
        removeExpression: (id: string) => void;
        getExpressions: () => any[];
        setMathBounds: (bounds: { left: number; right: number; bottom: number; top: number }) => void;
      };
    };
  }
}

const EQUATIONS_API_URL = 'http://localhost:8001';

export default function Desmos() {
  const calculatorRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [equations, setEquations] = useState<Equation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [lastAction, setLastAction] = useState<string>('');

  // Initialize the Desmos calculator
  useEffect(() => {
    const elt = document.getElementById('calculator');

    if (elt && window.Desmos) {
      // Initialize calculator with better default settings and dark mode
      calculatorRef.current = window.Desmos.GraphingCalculator(elt, {
        keypad: true,
        expressions: true,
        settingsMenu: true,
        zoomButtons: true,
        invertedColors: true, // Enable dark mode
        backgroundColor: '#1e1e1e' // Set a dark background color
      });

      // Apply some initial settings
      try {
        // Set bounds to make equations more visible
        calculatorRef.current.setMathBounds({
          left: -10,
          right: 10,
          bottom: -5,
          top: 5
        });

        console.log("Desmos calculator initialized successfully");
      } catch (err) {
        console.error("Error setting initial calculator state:", err);
      }

      // Fetch initial equations
      fetchEquations();
    } else {
      if (!elt) {
        console.error("Calculator element not found");
        setError("Calculator element not found in DOM");
      } else if (!window.Desmos) {
        console.error("Desmos library not loaded");
        setError("Desmos library not loaded");
      }
    }

    return () => {
      if (calculatorRef.current) {
        try {
          calculatorRef.current.destroy();
          console.log("Desmos calculator destroyed");
        } catch (err) {
          console.error("Error destroying calculator:", err);
        }
      }
    };
  }, []);

  // Setup WebSocket connection
  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        console.log("WebSocket connection closed during cleanup");
      }
    };
  }, []);

  // Fetch initial equations from the API
  const fetchEquations = async () => {
    try {
      console.log("Fetching initial equations...");
      const response = await fetch(`${EQUATIONS_API_URL}/equations/`);

      if (response.ok) {
        const data: Equation[] = await response.json();
        console.log(`Fetched ${data.length} equations from API`);
        setEquations(data);

        // Add each equation to the calculator
        data.forEach(equation => {
          addEquationToCalculator(equation);
        });

        setLastAction(`Loaded ${data.length} equations`);
      } else {
        const errorText = await response.text();
        console.error("Failed to fetch equations:", response.status, errorText);
        setError(`Failed to fetch equations: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error fetching equations:', error);
      setError(`Error connecting to equations API: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Connect to WebSocket for real-time updates
  const connectWebSocket = () => {
    console.log("Connecting to WebSocket...");
    const ws = new WebSocket(`ws://${window.location.hostname}:8001/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected successfully');
      setConnected(true);
      setError(null);
      setLastAction("WebSocket connected");
    };

    ws.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      setConnected(false);
      setLastAction(`WebSocket disconnected: ${event.code}`);

      // Attempt to reconnect after a delay
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CLOSED) {
          console.log("Attempting to reconnect WebSocket...");
          connectWebSocket();
        }
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
      setLastAction("WebSocket error occurred");
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("Received WebSocket message:", message.type);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
  };

  // Handle incoming WebSocket messages
  const handleWebSocketMessage = (message: any) => {
    switch (message.type) {
      case 'init':
        // Initial load of equations
        if (message.equations) {
          console.log(`Received initial ${message.equations.length} equations via WebSocket`);
          setEquations(message.equations);

          // Add each equation to the calculator
          message.equations.forEach((equation: Equation) => {
            addEquationToCalculator(equation);
          });

          setLastAction(`Initialized with ${message.equations.length} equations`);
        }
        break;

      case 'new_equation':
        // Add a new equation
        if (message.equation) {
          console.log("Received new equation via WebSocket:", message.equation.expression);
          setEquations(prev => [...prev, message.equation]);
          addEquationToCalculator(message.equation);
          setLastAction(`Added equation: ${message.equation.expression.substring(0, 20)}${message.equation.expression.length > 20 ? '...' : ''}`);
        }
        break;

      case 'delete_equation':
        // Remove an equation
        if (message.equation_id) {
          console.log("Removing equation:", message.equation_id);
          setEquations(prev => prev.filter(eq => eq.id !== message.equation_id));
          removeEquationFromCalculator(message.equation_id);
          setLastAction(`Removed equation: ${message.equation_id}`);
        }
        break;

      case 'clear_equations':
        // Clear all equations
        console.log("Clearing all equations");
        setEquations([]);
        clearAllEquationsFromCalculator();
        setLastAction("All equations cleared");
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  };

  // Add an equation to the Desmos calculator
  const addEquationToCalculator = (equation: Equation) => {
    if (!calculatorRef.current) {
      console.warn("Calculator not initialized, can't add equation");
      return;
    }

    try {
      console.log(`Adding equation to calculator: id=${equation.id}, expression=${equation.expression}`);
      calculatorRef.current.setExpression({
        id: equation.id,
        latex: equation.expression,
        color: equation.color || '#2d70b3',
        label: equation.label || ''
      });
    } catch (error) {
      console.error('Error adding equation to calculator:', error);
      // Try adding a simplified version as fallback
      try {
        calculatorRef.current.setExpression({
          id: equation.id,
          latex: 'y=x', // Fallback to a simple equation
          color: equation.color || '#2d70b3',
          label: `${equation.label || 'Error'} (Processing Error)`
        });
      } catch (fallbackError) {
        console.error('Even fallback equation failed:', fallbackError);
      }
    }
  };

  // Remove an equation from the calculator
  const removeEquationFromCalculator = (equationId: string) => {
    if (!calculatorRef.current) {
      console.warn("Calculator not initialized, can't remove equation");
      return;
    }

    try {
      console.log(`Removing equation from calculator: id=${equationId}`);
      calculatorRef.current.removeExpression({ id: equationId });
    } catch (error) {
      console.error('Error removing equation from calculator:', error);
    }
  };

  // Clear all equations from the calculator
  const clearAllEquationsFromCalculator = () => {
    if (!calculatorRef.current) {
      console.warn("Calculator not initialized, can't clear equations");
      return;
    }

    try {
      console.log("Clearing all equations from calculator");
      const expressions = calculatorRef.current.getExpressions();
      expressions.forEach((expr: any) => {
        calculatorRef.current.removeExpression({ id: expr.id });
      });
    } catch (error) {
      console.error('Error clearing equations from calculator:', error);
    }
  };

  // Test connection to the API
  const testConnection = async () => {
    try {
      const response = await fetch(`${EQUATIONS_API_URL}/`);
      if (response.ok) {
        console.log("API connection test successful");
        setLastAction("API connection test: OK");
        return true;
      } else {
        console.error("API connection test failed:", response.status);
        setLastAction(`API connection test failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error("API connection test error:", error);
      setLastAction(`API connection test error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  return (
    <div className="relative h-screen w-full flex flex-col">
      {/* Error message */}
      {error && (
        <div className="absolute top-2 left-2 z-10 bg-red-500 text-white px-3 py-1 rounded text-sm">
          {error}
        </div>
      )}

      {/* Last action indicator */}
      {lastAction && (
        <div className="absolute bottom-2 left-2 z-10 bg-gray-800 bg-opacity-75 text-white px-3 py-1 rounded text-xs max-w-xs truncate">
          Last: {lastAction}
        </div>
      )}

      {/* Debug buttons */}
      <div className="absolute bottom-2 right-2 z-10 flex gap-2">
        <button
          onClick={testConnection}
          className="bg-blue-600 text-white text-xs px-2 py-1 rounded hover:bg-blue-700"
        >
          Test API
        </button>
        <button
          onClick={fetchEquations}
          className="bg-green-600 text-white text-xs px-2 py-1 rounded hover:bg-green-700"
        >
          Reload Equations
        </button>
      </div>

      {/* Calculator container */}
      <div id="calculator" className="h-full w-full"></div>
    </div>
  );
}