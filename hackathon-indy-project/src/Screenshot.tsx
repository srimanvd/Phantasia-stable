import { useState, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { toast } from 'react-hot-toast';
import selectIcon from './assets/icons/selection.svg';
import './screenshot.css';

export default function Screenshot({ activeTab }: { activeTab: string}) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [endPos, setEndPos] = useState({ x: 0, y: 0 });
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [pdfRect, setPdfRect] = useState<DOMRect | null>(null);
  const selectionRef = useRef<HTMLDivElement>(null);

  // Get PDF viewer bounds on mount and window resize
  // Improve PDF element detection to work in both standalone and chatbot contexts
  useEffect(() => {
    const updatePdfRect = () => {
      // Expanded selector list to find PDF viewer in different contexts
      const pdfElement =
        document.querySelector('.rpv-core__viewer') ||
        document.querySelector('.rpv-core__inner-container') ||
        document.querySelector('.rpv-core__viewer-zone') ||
        document.querySelector('.h-\\[90vh\\]') ||
        document.querySelector('.pdf-container') ||  // Add common container class
        document.querySelector('[data-testid="pdf-viewer"]') || // Add test ID if used
        document.querySelector('iframe[title="PDF Viewer"]'); // Check for iframe viewers

      if (pdfElement) {
        const rect = pdfElement.getBoundingClientRect();
        setPdfRect(rect);
        console.log('%c PDF bounds found:', 'background: #ffa500; color: black; padding: 2px 5px;',
          `Left: ${rect.left.toFixed(0)}, Top: ${rect.top.toFixed(0)}, Right: ${rect.right.toFixed(0)}, Bottom: ${rect.bottom.toFixed(0)}, Width: ${rect.width.toFixed(0)}, Height: ${rect.height.toFixed(0)}`);
        console.log('%c PDF Element:', 'background: #ffa500; color: black; padding: 2px 5px;', pdfElement);
      } else {
        // If we can't find the PDF element, try to find any canvas elements that might be the PDF
        const canvasElements = document.querySelectorAll('canvas');
        if (canvasElements.length > 0) {
          // Use the largest canvas as a fallback
          let largestCanvas = canvasElements[0];
          let largestArea = 0;

          canvasElements.forEach(canvas => {
            const rect = canvas.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > largestArea) {
              largestArea = area;
              largestCanvas = canvas;
            }
          });

          setPdfRect(largestCanvas.getBoundingClientRect());
          console.log('Using largest canvas as PDF bounds:', largestCanvas.getBoundingClientRect());
        } else {
          console.warn('PDF viewer element not found');
        }
      }
    };

    // Run immediately and set up polling
    updatePdfRect();
    const interval = setInterval(updatePdfRect, 500); // Check more frequently
    window.addEventListener('resize', updatePdfRect);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updatePdfRect);
    };
  }, []);

  const isWithinPdfBounds = (x: number, y: number) => {
    if (!pdfRect) {
      console.log('%c No PDF bounds detected!', 'background: #ff0000; color: white; padding: 2px 5px;');
      return false;
    }
    const margin = 2;
    const isWithin = (
      x >= pdfRect.left + margin &&
      x <= pdfRect.right - margin &&
      y >= pdfRect.top + margin &&
      y <= pdfRect.bottom - margin
    );
    console.log('%c Mouse position check:', 'background: #3cb371; color: white; padding: 2px 5px;',
      `X: ${x.toFixed(0)}, Y: ${y.toFixed(0)}, Within bounds: ${isWithin ? 'YES' : 'NO'}`);
    return isWithin;
  };

  // Fixed handleMouseDown function
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isSelecting && !hasStarted) {
      const { clientX, clientY } = e;
      console.log('%c Mouse down at:', 'background: #4169e1; color: white; padding: 2px 5px;',
        `X: ${clientX.toFixed(0)}, Y: ${clientY.toFixed(0)}`);

      // If we have PDF bounds, check if we're within them
      if (pdfRect && isWithinPdfBounds(clientX, clientY)) {
        setStartPos({ x: clientX, y: clientY });
        setEndPos({ x: clientX, y: clientY });
        setHasStarted(true);
        console.log('%c Starting selection within PDF bounds', 'background: #008000; color: white; padding: 2px 5px;');
      } else if (!pdfRect) {
        // If we don't have PDF bounds, allow selection anywhere
        // This is a fallback for when the PDF detection fails
        setStartPos({ x: clientX, y: clientY });
        setEndPos({ x: clientX, y: clientY });
        setHasStarted(true);
        console.log('Starting selection without PDF bounds');
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isSelecting && hasStarted) {
      const { clientX, clientY } = e;
      // If we have PDF bounds, constrain to them, otherwise allow free movement
      if (pdfRect) {
        const x = Math.max(pdfRect.left, Math.min(clientX, pdfRect.right));
        const y = Math.max(pdfRect.top, Math.min(clientY, pdfRect.bottom));
        setEndPos({ x, y });
      } else {
        setEndPos({ x: clientX, y: clientY });
      }
    }
  };

  const handleMouseUp = async () => {
    if (isSelecting && hasStarted) {
      await captureSelectedArea();
      setIsSelecting(false);
      setHasStarted(false);
    }
  };

  const startSelection = () => {
    setCapturedImage(null);
    setIsSelecting(true);
    setHasStarted(false);

    // Add toast notification when starting selection - positioned top-right
    toast.success('Click and drag on the PDF to select an area', {
      duration: 3000,
      position: 'top-right',
      style: {
        borderRadius: '10px',
        background: '#333',
        color: '#fff',
      },
    });
  };

  // Capture and send the selected area to the server to be saved
  const captureSelectedArea = async () => {
    if (!pdfRect) return;

    const x = Math.min(startPos.x, endPos.x);
    const y = Math.min(startPos.y, endPos.y);
    const width = Math.abs(endPos.x - startPos.x);
    const height = Math.abs(endPos.y - startPos.y);

    if (width < 10 || height < 10) {
      toast.error('Selection area too small', {
        duration: 2000,
        style: {
          borderRadius: '10px',
          background: '#333',
          color: '#fff',
        },
      });
      return;
    }

    try {
      const pdfElement = document.querySelector('.rpv-core__viewer') ||
                         document.querySelector('.h-\\[90vh\\]');
      if (!pdfElement) return;

      const relativeX = x - pdfRect.left;
      const relativeY = y - pdfRect.top;

      let canvas;
      try {
        // Find the currently visible page canvas with better error handling
        let visiblePages = [];
        let currentPageCanvas = null;

        try {
          visiblePages = Array.from(pdfElement.querySelectorAll('.rpv-core__page-layer--visible canvas'));
          console.log('Visible pages found:', visiblePages.length);

          if (visiblePages.length > 0) {
            currentPageCanvas = visiblePages[0];
          } else {
            // Try alternative selectors
            const allCanvases = Array.from(pdfElement.querySelectorAll('canvas'));
            console.log('All canvases found:', allCanvases.length);

            // Find the canvas that contains our selection point
            for (const canvas of allCanvases) {
              const rect = canvas.getBoundingClientRect();
              if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                currentPageCanvas = canvas;
                console.log('Found canvas containing selection point');
                break;
              }
            }

            // If still not found, use the first canvas
            if (!currentPageCanvas && allCanvases.length > 0) {
              currentPageCanvas = allCanvases[0];
              console.log('Using first available canvas');
            }
          }
        } catch (selectorError) {
          console.error('Error finding canvas:', selectorError);
        }

        console.log('Selected canvas:', currentPageCanvas);

        if (currentPageCanvas) {
          try {
            // Get the canvas rect
            const canvasRect = currentPageCanvas.getBoundingClientRect();
            console.log('Canvas rect:', canvasRect);
            console.log('PDF rect:', pdfRect);
            console.log('Selection coordinates:', x, y, width, height);

            // Calculate the offset within the current page
            const pageOffsetX = canvasRect.left - pdfRect.left;
            const pageOffsetY = canvasRect.top - pdfRect.top;

            // Adjust the relative coordinates to be relative to the current page canvas
            const adjustedX = relativeX - pageOffsetX;
            const adjustedY = relativeY - pageOffsetY;

            // Ensure coordinates are within bounds
            const boundedX = Math.max(0, adjustedX);
            const boundedY = Math.max(0, adjustedY);

            // Get the canvas dimensions safely
            const canvasWidth = currentPageCanvas.getAttribute('width') ?
              parseInt(currentPageCanvas.getAttribute('width') || '0', 10) :
              canvasRect.width;

            const canvasHeight = currentPageCanvas.getAttribute('height') ?
              parseInt(currentPageCanvas.getAttribute('height') || '0', 10) :
              canvasRect.height;

            // Get the canvas scaling factors
            const scaleX = canvasWidth / canvasRect.width;
            const scaleY = canvasHeight / canvasRect.height;

            // Calculate the scaled coordinates
            const scaledX = boundedX * scaleX;
            const scaledY = boundedY * scaleY;
            const scaledWidth = Math.min(width * scaleX, canvasWidth - scaledX);
            const scaledHeight = Math.min(height * scaleY, canvasHeight - scaledY);

            console.log('Adjusted coordinates:', boundedX, boundedY);
            console.log('Canvas dimensions:', canvasWidth, canvasHeight);
            console.log('Scaled selection:', scaledX, scaledY, scaledWidth, scaledHeight);

            // Create a new canvas for our cropped area
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = scaledWidth;
            tempCanvas.height = scaledHeight;

            // Draw only the selected portion with proper scaling
            const ctx = tempCanvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(
currentPageCanvas as HTMLCanvasElement,
                scaledX, scaledY, scaledWidth, scaledHeight, // Source coordinates (scaled)
                0, 0, scaledWidth, scaledHeight // Destination coordinates
              );
              canvas = tempCanvas;
            } else {
              throw new Error('Could not get canvas context');
            }
          } catch (drawError) {
            console.error('Error drawing to canvas:', drawError);
            throw drawError;
          }
        } else {
          // Fallback to html2canvas with minimal options
          canvas = await html2canvas(pdfElement as HTMLElement, {
            useCORS: true,
            allowTaint: true,
            x: relativeX,
            y: relativeY,
            width,
            height,
            scrollX: 0,
            scrollY: 0,
            backgroundColor: '#ffffff',
            scale: 1,
            onclone: (doc, elm) => {
              console.log('Cloned document for capture');
              return elm;
            }
          });
        }
      } catch (canvasError) {
        console.error("Screenshot capture error:", canvasError);
        alert("Failed to capture screenshot. Please try a different area of the PDF.");
        return;
      }

      // Set the captured image but don't show it in the UI
      const image = canvas.toDataURL('image/png');
      setCapturedImage(image);


      console.log('Attempting to send image to server...');

      try {
        // Update the fetch URL to include the server port
        const response = await fetch('http://localhost:4444/api/save-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ imageData: image }),
        });

        console.log('Server response status:', response.status);

        if (response.ok) {
          const data = await response.json();
          console.log('Image saved successfully:', data);

          // Dismiss loading toast and show success toast
          toast.success('Screenshot saved!', {
            duration: 2500,
            position: 'bottom-right',
            style: {
              borderRadius: '10px',
              background: '#333',
              color: '#fff',
            },
          });
        } else {
          const errorText = await response.text();
          console.error('Server error while saving image:', errorText);

          // Dismiss loading toast and show error toast
          toast.error('Failed to save screenshot', {
            duration: 2500,
            position: 'bottom-right',
            style: {
              borderRadius: '10px',
              background: '#333',
              color: '#fff',
            },
          });
        }
      } catch (networkError) {
        console.error('Network error when contacting server:', networkError);

        // Show error toast without referencing loadingToast
        toast.error('Network error. Check server connection.', {
          duration: 4000,
          position: 'top-right',
          style: {
            borderRadius: '10px',
            background: '#333',
            color: '#fff',
          },
        });
      }
    } catch (error) {
      console.error("Screenshot capture failed:", error);
      // Show error toast without referencing loadingToast
      toast.error('Failed to capture screenshot', {
        duration: 3000,
        position: 'top-right',
        style: {
          borderRadius: '10px',
          background: '#333',
          color: '#fff',
        },
      });
    }
  };

  const selectionStyle = {
    left: `${Math.min(startPos.x, endPos.x)}px`,
    top: `${Math.min(startPos.y, endPos.y)}px`,
    width: `${Math.abs(endPos.x - startPos.x)}px`,
    height: `${Math.abs(endPos.y - startPos.y)}px`,
    display: isSelecting && hasStarted ? 'block' : 'none',
    border: '2px dashed #e0aaff', // Changed to dashed and using your color scheme
    backgroundColor: 'rgba(224, 170, 255, 0.1)', // Light purple background
    zIndex: 9999 // Ensure it's above everything
  };

  return (
    <div className="flex flex-col gap-4 h-full w-full">
      <button
          onClick={startSelection}
          data-tip="Select"
          disabled={!(activeTab === 'chat') || isSelecting}
          className={`tooltip btn btn-square btn-outline ${activeTab === 'chat' ? 'btn-primary' : 'btn-neutral'}`}
          >
            <img src={selectIcon} alt="Selection" className="w-5 h-full"/>
          </button>

      <div
        ref={selectionRef}
        className="fixed border-4 border-primary bg-blue-200 z-50 pointer-events-none"
        style={selectionStyle}
      />

      {/* {capturedImage && (
        <div className="mt-4 border p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Captured PDF Snippet:</h2>
          <img
            src={capturedImage}
            alt="Captured PDF snippet"
            className="max-w-full border rounded-lg shadow-lg"
          />
        </div>
      )} */}

    <div
      className="fixed inset-0 w-full h-full z-50 pointer-events-auto"
      style={{
        display: isSelecting ? 'block' : 'none',
        cursor: isSelecting ? 'crosshair' : 'default' // Add crosshair cursor
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />

    </div>
  );
}
