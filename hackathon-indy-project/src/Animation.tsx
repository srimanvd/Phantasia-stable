import { useState, useEffect, useRef } from "react";
import './screenshot.css'; // Assuming your CSS is correctly linked

export default function Animation() {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null); // Changed from videoBlob to videoUrl
  const textareaRef = useRef(null);
  const videoRef = useRef(null);

  // Function to handle sending the prompt
  const handleSend = () => {
    if (!prompt.trim()) return;
    console.log("Sending request with prompt:", prompt);

    // Reset states
    setIsLoading(true);
    setError(null);
    setVideoUrl(null); // Reset video URL
    setJobId(null); // Reset job ID in case of re-sending

    // Use XMLHttpRequest instead of fetch
    const xhr = new XMLHttpRequest();
    // This endpoint (5555) seems correct for *initiating* the job
    xhr.open("POST", "http://localhost:5555/generate-video", true);
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        console.log("Response status:", xhr.status);
        console.log("Response text:", xhr.responseText);
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            console.log("Parsed data:", data);
            if (data.job_id) {
              setJobId(data.job_id);
              // Don't set isLoading to false here, polling starts
            } else {
              setError("No job ID received");
              setIsLoading(false);
            }
          } catch (err) {
            console.error("Error parsing response:", err);
            setError("Error parsing server response");
            setIsLoading(false);
          }
        } else {
           // Try to parse error message from backend if possible
           let errorMessage = `Request failed with status ${xhr.status}`;
           try {
               const errorData = JSON.parse(xhr.responseText);
               if(errorData.message) {
                   errorMessage += `: ${errorData.message}`;
               }
           } catch(parseError) {
                // Ignore if response is not JSON
           }
           setError(errorMessage);
           setIsLoading(false);
        }
      }
    };

    xhr.onerror = function() {
      console.error("Network error occurred");
      setError("Network error occurred. Ensure the backend server is running.");
      setIsLoading(false);
    };

    // Send the request
    xhr.send(JSON.stringify({ prompt: prompt.trim() }));
  };

  // Handle keyboard shortcut (Shift+Enter)
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Poll for job status when jobId changes
  useEffect(() => {
    if (!jobId) return;

    let isCancelled = false; // Flag to prevent state updates after cancellation
    let timeoutId = null;

    const checkStatus = () => {
      if (isCancelled) return; // Stop polling if cancelled

      console.log(`Checking status for job ID: ${jobId}`);
      const xhr = new XMLHttpRequest();
      // This endpoint (5555) seems correct for *checking job status*
      xhr.open("GET", `http://localhost:5555/job-status/${jobId}`, true);

      xhr.onreadystatechange = function() {
        if (isCancelled) return; // Stop processing if cancelled

        if (xhr.readyState === 4) {
          if (xhr.status === 200) {
            try {
              const statusData = JSON.parse(xhr.responseText);
              console.log("Status data received:", statusData);
              const currentStatus = statusData.status;

              if (currentStatus === "success") {
                console.log("Job completed successfully. Setting video URL.");
                // --- CHANGE HERE ---
                // Construct the direct URL to the video file served from port 5556
                const timestamp = Date.now(); // Add timestamp to prevent caching issues
                const url = `http://localhost:5556/temp.mp4?t=${timestamp}`;
                // --- END CHANGE ---
                console.log("Setting video source to:", url);

                setVideoUrl(url); // Set the direct URL
                setIsLoading(false);
                setJobId(null); // Stop polling

              } else if (currentStatus === "error") {
                console.error("Video generation failed:", statusData.message);
                setError(statusData.message || "Video generation failed on the server");
                setIsLoading(false);
                setJobId(null); // Stop polling

              } else {
                 console.log(`Job status: ${currentStatus}. Polling again in 3 seconds.`);
                // Still processing, check again in 3 seconds
                timeoutId = setTimeout(checkStatus, 3000);
              }
            } catch (err) {
              console.error("Error parsing status:", err);
              setError("Error parsing status response");
              setIsLoading(false);
              setJobId(null); // Stop polling
            }
          } else {
            setError(`Status check failed with status ${xhr.status}`);
            setIsLoading(false);
            setJobId(null); // Stop polling
          }
        }
      };

      xhr.onerror = function() {
        if (isCancelled) return; // Stop processing if cancelled
        console.error("Network error checking status");
        setError("Network error checking job status. Ensure backend is running.");
        setIsLoading(false);
        setJobId(null); // Stop polling
      };

      xhr.send();
    };

    checkStatus(); // Start the first check

    // Cleanup function: This runs when jobId changes or the component unmounts
    return () => {
      console.log("Cleaning up polling effect for job ID:", jobId);
      isCancelled = true; // Set the flag to stop any ongoing XHR/timeouts
      if (timeoutId) {
        clearTimeout(timeoutId); // Clear any pending timeout
      }
    };

  }, [jobId]); // Rerun effect only when jobId changes


  return (
    <>
      <div className="flex justify-center w-full">
        {/* Conditionally apply background color */}
        <div
          className={`rounded-lg overflow-hidden ${videoUrl ? '' : 'bg-[#1A1A1A]'}`} // Remove background when video is served
          style={{ width: "600px", height: "600px" }}
        >
          {isLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2">
              <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary"></div>
              <p className="text-white mt-8">Generating video...</p> {/* Added margin for separation */}
            </div>
          ) : error ? (
            <div className="w-full h-full flex items-center justify-center text-red-500 p-4 text-center">
              <div>
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                <p className="mt-2">{error}</p>
              </div>
            </div>
          ) : videoUrl ? (
            <div className="w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                key={videoUrl}
                src={videoUrl}
                width="1200"
                height="900"
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-full object-contain"
                onError={(e) => {
                  console.error("Video element error:", e);
                  setError(`Error playing video from ${videoUrl.split('?')[0]}. Check console (F12 -> Network) for details. Is the server on port 5556 running and serving the file? Is CORS configured correctly on that server?`);
                  setVideoUrl(null);
                }}
                onLoadedData={() => console.log("Video data loaded successfully.")}
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500">
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#1A1A1A] text-center p-6 gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24"
                     fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                     className="mb-6">
                  <polygon points="23 7 16 12 23 17 23 7"></polygon>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
                <p className="text-gray-300 text-xl mb-2">Create a video</p>
                <p className="text-gray-500 text-sm max-w-md">Enter a prompt below and click Send to generate a video</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="w-full px-4 flex justify-center">
        <div className="w-150">
           {/* --- Input Area --- */}
          <div className="input-container">
            <div className="textarea-wrapper">
              <textarea
                ref={textareaRef}
                className="message-input w-full"
                placeholder="Describe math video..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
              />
            </div>
            <div className="input-buttons">
              <div className="left-buttons">
                {/* Placeholder */}
              </div>
              <div className="flex flex-col justify-items-center">
                <div className="special-card">
                  <button
                    className={`action-button send-button ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={handleSend}
                    type="button"
                    disabled={isLoading}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
