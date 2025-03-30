import requests
import time
import os
import json
import argparse
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

def test_video_generation(prompt, base_url="http://localhost:5555"):
    """
    Test the video generation API by sending a request and monitoring the job status

    Args:
        prompt (str): The prompt to send to the API
        base_url (str): Base URL of the API server

    Returns:
        bool: True if successful, False otherwise
    """
    print(f"Testing video generation with prompt: {prompt}")

    # Send the request to generate video
    try:
        response = requests.post(
            f"{base_url}/generate-video",
            json={"prompt": prompt},
            timeout=30
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"Error sending request: {e}")
        return False

    # Get the job ID from the response
    data = response.json()
    if "job_id" not in data:
        print(f"Error: No job_id in response: {data}")
        return False

    job_id = data["job_id"]
    print(f"Job started with ID: {job_id}")

    # Poll for job status until complete or error
    max_polls = 100
    poll_interval = 5  # seconds

    for i in range(max_polls):
        try:
            status_response = requests.get(f"{base_url}/job-status/{job_id}", timeout=10)
            status_response.raise_for_status()
            status_data = status_response.json()

            print(f"Poll {i + 1}: Status = {status_data.get('status')}, Message = {status_data.get('message')}")

            # Check if the job is complete
            if status_data.get("status") == "success":
                print("Video generated successfully!")

                # Check if the video file exists in the video_server directory
                video_path = Path("video_server/temp.mp4")
                if video_path.exists():
                    print(f"Video file exists at: {video_path.absolute()}")
                    print(f"File size: {video_path.stat().st_size} bytes")
                    return True
                else:
                    print(f"Error: Video file not found at {video_path.absolute()}")
                    return False

            elif status_data.get("status") == "error":
                print(f"Error generating video: {status_data.get('message')}")
                return False

            # If still processing, wait and try again
            if status_data.get("status") == "processing":
                print(f"Still processing, waiting {poll_interval} seconds...")
                time.sleep(poll_interval)
                continue

        except requests.exceptions.RequestException as e:
            print(f"Error polling job status: {e}")
            # Don't return False yet, try again

    print(f"Timed out after {max_polls} polls")
    return False


def verify_environment():
    """Check if the necessary environment variables are set"""
    required_vars = ["DEEPSEEKAPIKEY", "GEMINI_API_KEY"]
    missing = []

    for var in required_vars:
        if not os.environ.get(var):
            missing.append(var)

    if missing:
        print(f"Error: Missing environment variables: {', '.join(missing)}")
        print("Please set these variables before running the test.")
        return False

    return True


def main():
    parser = argparse.ArgumentParser(description="Test the video generation API")
    parser.add_argument("--prompt", type=str, default="SHow me hte derivative for sigmoid",
                        help="Prompt to use for video generation")
    parser.add_argument("--url", type=str, default="http://localhost:5555",
                        help="Base URL of the API server")

    args = parser.parse_args()

    # Verify that the video_server directory exists
    video_server_dir = Path("video_server")
    if not video_server_dir.exists():
        print(f"Creating video_server directory at {video_server_dir.absolute()}")
        video_server_dir.mkdir(exist_ok=True)

    # Check environment variables
    if not verify_environment():
        return 1

    # Run the test
    success = test_video_generation(args.prompt, args.url)

    if success:
        print("Test completed successfully!")
        return 0
    else:
        print("Test failed!")
        return 1


if __name__ == "__main__":
    exit_code = main()
    exit(exit_code)
