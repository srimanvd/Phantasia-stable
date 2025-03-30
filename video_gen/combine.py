from openai import OpenAI
from dotenv import load_dotenv
import os
import py_compile
import tempfile
import subprocess
from pathlib import Path
import shutil
import glob
from pydantic import BaseModel, Field
from google import genai
import concurrent.futures
import traceback
import sys
import time
from flask import Flask, request, jsonify
import threading
import uuid
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


class Scene(BaseModel):
    title: str = Field(..., description="Title of the scene/topic")
    description: str = Field(..., description="Description of the scene in brief on what to include. Keep it short")


class VideoRequest(BaseModel):
    scenes: list[Scene] = Field(..., description="List of scenes to be included in the video")
    video_title: str = Field(..., description="Title of the video")


def setup_environment():
    try:
        load_dotenv()
        deepseek_api_key = os.getenv("DEEPSEEKAPIKEY")
        gemini_api_key = os.getenv("GEMINI_API_KEY")

        if not deepseek_api_key:
            print("ERROR: Missing DEEPSEEKAPIKEY in environment")
            return None, None

        if not gemini_api_key:
            print("ERROR: Missing GEMINI_API_KEY in environment")
            return None, None

        gemini = genai.Client(api_key=gemini_api_key)
        client = OpenAI(api_key=deepseek_api_key, base_url="https://api.deepseek.com")

        print("Environment setup successful")
        return gemini, client
    except Exception as e:
        print(f"ERROR in setup_environment: {e}")
        traceback.print_exc()
        return None, None


def extract_python_code(content):
    try:
        if "```python" in content:
            python_code = content.split("```python")[1].split("```")[0]
            return python_code
        elif "```" in content:
            # Try generic code block
            python_code = content.split("```")[1].split("```")[0]
            return python_code
        else:
            print("No code block markers found in response")
            return None
    except IndexError as e:
        print(f"ERROR extracting Python code: {e}")
        print(f"Content: {content[:500]}...")  # Print first 500 chars for debugging
        return None
    except Exception as e:
        print(f"Unexpected error extracting code: {e}")
        traceback.print_exc()
        return None


def compile_code(code, temp_file_path):
    try:
        py_compile.compile(temp_file_path, doraise=True)
        print("Code compiled successfully.")
        return True
    except py_compile.PyCompileError as e:
        print("Compilation failed with PyCompileError:")
        print(e)
        return False
    except SyntaxError as e:
        print("Compilation failed with SyntaxError:")
        print(e)
        return False
    except Exception as e:
        print(f"Compilation failed with unexpected error: {type(e).__name__}")
        traceback.print_exc()
        return False


def request_code(client, model_name, system_prompt, input_prompt, max_retries=3):
    message = system_prompt + " " + input_prompt
    retry_count = 0

    while retry_count < max_retries:
        try:
            print(f"Requesting code from {model_name}, attempt {retry_count + 1}")
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {
                        "role": "user",
                        "content": message
                    }
                ],
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"API request failed: {e}")
            traceback.print_exc()
            retry_count += 1
            if retry_count < max_retries:
                print(f"Retrying in 5 seconds...")
                time.sleep(5)

    print("All API request attempts failed")
    return None


def get_video_gencode(client, prompt, max_retries=20):  # Increased max_retries from 10 to 20
    from prompt_video import system_prompt

    attempt = 0
    current_prompt = prompt
    error_context = ""

    while attempt < max_retries:
        model = "deepseek-chat"
        print(f"Attempt {attempt + 1} using model: {model}")

        # Include previous error in the prompt if available
        full_prompt = current_prompt
        if error_context:
            full_prompt = f"{current_prompt}\n\nPrevious attempt failed with the following error. Please fix it:\n{error_context}"
            print(f"Including error context in prompt: {error_context}")

        content = request_code(client, model, system_prompt, full_prompt)
        if not content:
            print("Failed to get response from API")
            attempt += 1
            time.sleep(2)  # Added delay between retries
            continue

        python_code = extract_python_code(content)
        if not python_code:
            print("Could not extract Python code from response.")
            attempt += 1
            error_context = "Could not extract Python code from response. Make sure to include your code within ```python and ``` markers."
            time.sleep(2)  # Added delay between retries
            continue

        # Write code to temp file for compilation testing
        temp_file_path = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as temp_file:
                temp_file.write(python_code)
                temp_file_path = temp_file.name

            # Test compilation
            if compile_code(python_code, temp_file_path):
                # Further validation: check for known Manim issues
                if "height" in python_code and "Axes(" in python_code:
                    print("WARNING: Code might contain the 'height' parameter issue with Axes()")
                    # Try to fix the height parameter issue
                    if "height=" in python_code:
                        python_code = python_code.replace("height=", "y_length=")
                        print("Automatically replaced 'height=' with 'y_length='")

                        # Re-test the fixed code
                        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as fixed_file:
                            fixed_file.write(python_code)
                            fixed_file_path = fixed_file.name

                        if not compile_code(python_code, fixed_file_path):
                            error_context = "Code still has issues after automatic fixes."
                            os.remove(fixed_file_path)
                            attempt += 1
                            time.sleep(2)  # Added delay between retries
                            continue

                        os.remove(fixed_file_path)

                # Additional validation for Manim-specific syntax
                if "Axes(" in python_code:
                    for invalid_param in ["height=", "width="]:
                        if invalid_param in python_code:
                            print(f"WARNING: Found potential Manim API issue: {invalid_param}")
                            error_context = f"Manim API issue: {invalid_param} is not a valid parameter for Axes. Use x_length and y_length instead."
                            break
                    else:  # No breaks occurred
                        # All checks passed, return the code
                        if temp_file_path and os.path.exists(temp_file_path):
                            os.remove(temp_file_path)
                        return python_code
                else:
                    # No Axes objects to check, return the code
                    if temp_file_path and os.path.exists(temp_file_path):
                        os.remove(temp_file_path)
                    return python_code
            else:
                # Compilation failed, update error context for next attempt
                error_context = f"Compilation error in previous code."
        except Exception as e:
            print(f"Unexpected error during code validation: {e}")
            traceback.print_exc()
            error_context = f"Unexpected error: {str(e)}"
        finally:
            # Clean up temp file
            if temp_file_path and os.path.exists(temp_file_path):
                try:
                    os.remove(temp_file_path)
                except:
                    pass

        # If we got here, there was an error - increment attempt counter
        attempt += 1

        # Add some delay between retries
        time.sleep(2)

    print("All attempts failed to produce valid Python code.")
    return None


def manim_render(code, output_dir, scene_class=None, max_retries=5):  # Added max_retries parameter
    retry_count = 0
    original_code = code

    while retry_count < max_retries:
        try:
            print(f"Manim render attempt {retry_count + 1} of {max_retries}")
            Path(output_dir).mkdir(parents=True, exist_ok=True)

            # Create a temp file with the code
            temp_file_path = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as temp_file:
                    temp_file.write(code)
                    temp_file_path = temp_file.name

                # Determine the scene class name from the code if not provided
                if not scene_class:
                    import re
                    scene_class_match = re.search(r'class\s+(\w+)\(Scene\)', code)
                    if scene_class_match:
                        scene_class = scene_class_match.group(1)
                        print(f"Detected scene class: {scene_class}")
                    else:
                        print("WARNING: Could not determine scene class name. Using default options.")

                # Build the command
                command = f"manim -pql --media_dir {output_dir} {temp_file_path}"
                if scene_class:
                    command += f" {scene_class}"

                print(f"Executing command: {command}")

                # Run the command and capture output
                process = subprocess.Popen(
                    command,
                    shell=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )

                # Print output in real-time
                stderr_output = ""
                for line in process.stdout:
                    print(line, end='')
                    # Look for the path output line
                    if "File ready at" in line:
                        video_path = line.strip().split("File ready at ")[-1]
                        print(f"\nVIDEO PATH: {video_path}")

                # Wait for process to complete
                return_code = process.wait()

                # Capture stderr output
                stderr_output = process.stderr.read()

                # Check if the process succeeded
                if return_code != 0:
                    print(f"Manim render failed with return code {return_code}")
                    print(f"Error output: {stderr_output}")

                    # Try to fix the code based on the error
                    fixed_code = None
                    if "has no attribute 'y_length'" in stderr_output and "height" not in code:
                        fixed_code = code.replace("y_length=", "height=")
                        print("Trying with 'height=' instead of 'y_length='")
                    elif "has no attribute 'x_length'" in stderr_output and "width" not in code:
                        fixed_code = code.replace("x_length=", "width=")
                        print("Trying with 'width=' instead of 'x_length='")
                    elif "y_length" in code:
                        fixed_code = code.replace("y_length=", "height=")
                        print("Trying with 'height=' instead of 'y_length='")
                    elif "x_length" in code:
                        fixed_code = code.replace("x_length=", "width=")
                        print("Trying with 'width=' instead of 'x_length='")
                    elif "height=" in code and retry_count == 0:
                        fixed_code = code.replace("height=", "y_length=")
                        print("Trying with 'y_length=' instead of 'height='")
                    elif "width=" in code and retry_count == 0:
                        fixed_code = code.replace("width=", "x_length=")
                        print("Trying with 'x_length=' instead of 'width='")
                    elif retry_count == max_retries - 1:
                        # Last attempt, try reverting to original code
                        fixed_code = original_code
                        print("Reverting to original code for final attempt")

                    if fixed_code:
                        code = fixed_code

                    retry_count += 1
                    if retry_count < max_retries:
                        time.sleep(2)  # Add delay between retries
                        continue
                    return False, None

                # Find the latest created video file
                video_files = glob.glob(f"{output_dir}/**/*.mp4", recursive=True)
                if video_files:
                    video_files.sort(key=os.path.getmtime, reverse=True)
                    latest_video = video_files[0]
                    print(f"\nVIDEO PATH: {latest_video}")
                    return True, latest_video
                else:
                    print("No video files found in output directory")
                    retry_count += 1
                    if retry_count < max_retries:
                        time.sleep(2)  # Add delay between retries
                        continue
                    return False, None

            finally:
                # Clean up the temp file
                if temp_file_path and os.path.exists(temp_file_path):
                    try:
                        os.remove(temp_file_path)
                    except:
                        pass

        except Exception as e:
            print(f"ERROR in manim_render: {e}")
            traceback.print_exc()
            retry_count += 1
            if retry_count < max_retries:
                time.sleep(2)  # Add delay between retries
                continue
            return False, None

    print("All manim render attempts failed")
    return False, None


def scene_processing(gemini, prompt, max_retries=5):
    from prompt_video import gemini_prompt

    retry_count = 0
    while retry_count < max_retries:
        try:
            print(f"Requesting scene processing, attempt {retry_count + 1}")
            response = gemini.models.generate_content(
                model="gemini-2.0-flash",
                contents=gemini_prompt + " " + prompt,
                config={
                    'response_mime_type': 'application/json',
                    'response_schema': VideoRequest
                }
            )

            return response.text
        except Exception as e:
            print(f"Scene processing failed: {e}")
            traceback.print_exc()
            retry_count += 1
            if retry_count < max_retries:
                print(f"Retrying in 3 seconds...")
                time.sleep(3)

    print("All scene processing attempts failed")
    return None


def add_audio(gemini, gemini_response_individual, max_attempts=5):
    def attempt_generation(attempt_num):
        try:
            print(f"Attempting audio generation, attempt {attempt_num}")
            response = gemini.models.generate_content(
                model="gemini-2.0-flash",
                contents=gemini_response_individual,
            )
            temp_response = response.text
            python_code_audio = extract_python_code(temp_response)
            if python_code_audio:
                # Validate the code
                with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as temp_file:
                    temp_file.write(python_code_audio)
                    temp_file_path = temp_file.name

                is_valid = compile_code(python_code_audio, temp_file_path)

                if os.path.exists(temp_file_path):
                    os.remove(temp_file_path)

                if is_valid:
                    return python_code_audio
                else:
                    print(f"Audio code generation attempt {attempt_num} produced invalid code")
                    return None
            else:
                print(f"Audio code generation attempt {attempt_num} failed to extract code")
                return None
        except Exception as e:
            print(f"Audio generation attempt {attempt_num} failed with error: {e}")
            traceback.print_exc()
            return None

    # Try sequential attempts first
    for i in range(max_attempts):
        result = attempt_generation(i + 1)
        if result:
            return result
        time.sleep(1)  # Brief delay between attempts

    print("All sequential audio generation attempts failed, trying parallel approach")

    # If sequential attempts fail, try parallel approach
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_attempts) as executor:
        futures = [executor.submit(attempt_generation, i + 1) for i in range(max_attempts)]
        for future in concurrent.futures.as_completed(futures):
            try:
                result = future.result()
                if result:
                    results.append(result)
            except Exception as e:
                print(f"Thread-based attempt failed with error: {e}")
                traceback.print_exc()

    if results:
        return results[0]
    else:
        raise Exception("All attempts failed to generate valid audio code.")


def clear_directory(directory_path):
    """Delete all files in a directory"""
    try:
        if os.path.exists(directory_path):
            for file in os.listdir(directory_path):
                file_path = os.path.join(directory_path, file)
                if os.path.isfile(file_path):
                    os.unlink(file_path)
            print(f"Cleared all files in {directory_path}")
            return True
        return False
    except Exception as e:
        print(f"Error clearing directory {directory_path}: {e}")
        traceback.print_exc()
        return False


def move_video_to_video_server(video_path, session_id):
    """Move a video file to the video_server directory"""
    if not video_path or not os.path.exists(video_path):
        print(f"Video path does not exist: {video_path}")
        return None

    # Create video_server directory if it doesn't exist
    dest_dir = "video_server"
    Path(dest_dir).mkdir(parents=True, exist_ok=True)

    # Clean any existing mp4 files in the directory
    for existing_file in Path(dest_dir).glob("*.mp4"):
        try:
            existing_file.unlink()
            print(f"Deleted existing file: {existing_file}")
        except Exception as e:
            print(f"Error deleting file {existing_file}: {e}")

    # Set the destination filename to temp.mp4
    dest_path = os.path.join(dest_dir, "temp.mp4")

    try:
        # Copy the file
        shutil.copy2(video_path, dest_path)
        print(f"Video copied to: {dest_path}")
        return dest_path
    except Exception as e:
        print(f"Error moving video: {e}")
        traceback.print_exc()
        return None


def clean_output_dir(output_dir):
    """Delete the output directory and all its contents"""
    try:
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
            print(f"Output directory {output_dir} deleted successfully")
            return True
        return False
    except Exception as e:
        print(f"Error cleaning output directory: {e}")
        traceback.print_exc()
        return False


def process_video_request(prompt, session_id):
    """Process a video generation request"""
    max_overall_attempts = 5  # Number of times to try the entire process if needed
    attempt = 0

    while attempt < max_overall_attempts:
        try:
            print(f"Overall video generation attempt {attempt + 1} of {max_overall_attempts}")

            # Initialize environment
            gemini, client = setup_environment()
            if not gemini or not client:
                print("Failed to initialize environment. Retrying...")
                attempt += 1
                time.sleep(5)
                continue

            output_dir = f"output_{session_id}"

            # Get scene information
            print("Processing scene information...")
            gemini_response = scene_processing(gemini, prompt)
            if not gemini_response:
                print("Failed to process scene information. Retrying...")
                attempt += 1
                time.sleep(5)
                continue

            video_paths = []
            try:
                import json
                gemini_response_parsed = json.loads(gemini_response)
                print("Scene information received:")
                print(gemini_response_parsed)

                # Process each scene
                for i, scene in enumerate(gemini_response_parsed["scenes"]):
                    title = scene["title"]
                    description = scene["description"]
                    scene_prompt = title + " " + description

                    print(f"\nProcessing scene {i + 1}: {title}")
                    print(f"Description: {description}")

                    # Retry loop for each scene
                    scene_attempts = 0
                    max_scene_attempts = 5
                    while scene_attempts < max_scene_attempts:
                        # Generate video code
                        code = get_video_gencode(client, scene_prompt)
                        if not code:
                            print(
                                f"Failed to generate valid Manim code for scene {i + 1}. Attempt {scene_attempts + 1} of {max_scene_attempts}.")
                            scene_attempts += 1
                            time.sleep(3)
                            continue

                        # Render the video with enhanced retry logic
                        render_success, video_path = manim_render(code, output_dir, max_retries=5)
                        if render_success and video_path:
                            # Add to video paths list
                            video_paths.append(video_path)
                            print(f"Video for scene {i + 1} rendered successfully: {video_path}")
                            break  # Succeeded, exit the retry loop
                        else:
                            print(
                                f"Failed to render video for scene {i + 1}. Attempt {scene_attempts + 1} of {max_scene_attempts}.")
                            scene_attempts += 1
                            # Try with some common code modifications
                            if scene_attempts < max_scene_attempts:
                                time.sleep(3)
                                continue

                    # If all scene attempts failed, continue to the next scene
                    if scene_attempts >= max_scene_attempts:
                        print(f"All attempts failed for scene {i + 1}. Moving to next scene.")
                        continue

                    # Add audio
                    try:
                        from prompt_video import audio_prompt
                        print("Generating audio code...")
                        gemini_response_individual = audio_prompt + " " + code
                        audio_code = add_audio(gemini, gemini_response_individual)

                        if audio_code:
                            print("Rendering with audio...")
                            audio_render_success, audio_video_path = manim_render(audio_code, output_dir, max_retries=5)
                            if audio_render_success and audio_video_path:
                                print(f"Scene {i + 1} with audio rendered successfully: {audio_video_path}")
                                # Replace the non-audio version with the audio version in our list
                                if audio_video_path:
                                    video_paths[-1] = audio_video_path
                            else:
                                print(f"Failed to render scene {i + 1} with audio. Keeping non-audio version.")
                        else:
                            print(f"Failed to generate audio code for scene {i + 1}. Keeping non-audio version.")
                    except Exception as e:
                        print(f"Error processing audio for scene {i + 1}: {e}")
                        traceback.print_exc()

                print("\nAll scenes processed.")

                # Move final video to video_server directory if we have any
                if video_paths:
                    # Use the last video as the final one
                    final_video_path = video_paths[-1]
                    asset_path = move_video_to_video_server(final_video_path, session_id)

                    # Clean up output directory
                    clean_output_dir(output_dir)

                    if asset_path:
                        return {
                            "status": "success",
                            "message": "Video generated successfully",
                            "video_path": asset_path
                        }

                # If we get here without returning, that means we didn't successfully process any videos
                print("No videos were successfully generated in this attempt.")
                attempt += 1
                time.sleep(5)  # Wait before retrying the whole process
                continue

            except json.JSONDecodeError as e:
                print(f"Failed to parse scene information: {e}")
                print(f"Raw response: {gemini_response}")
                attempt += 1
                time.sleep(5)
                continue
            except Exception as e:
                print(f"Error processing scenes: {e}")
                traceback.print_exc()
                attempt += 1
                time.sleep(5)
                continue

        except Exception as e:
            print(f"Unexpected error in process_video_request: {e}")
            traceback.print_exc()
            attempt += 1
            time.sleep(5)
            continue

    # If we've exhausted all retries and still don't have a video, return error
    return {
        "status": "error",
        "message": "Failed to generate video after multiple attempts"
    }


# Store job status
job_status = {}


@app.route('/generate-video', methods=['POST'])
def generate_video():
    if not request.is_json:
        return jsonify({"status": "error", "message": "Request must be JSON"}), 400

    data = request.get_json()
    prompt = data.get('prompt')

    if not prompt:
        return jsonify({"status": "error", "message": "Prompt is required"}), 400

    # Create video_server directory if it doesn't exist
    video_server_dir = "video_server"
    Path(video_server_dir).mkdir(parents=True, exist_ok=True)

    # Clear any existing mp4 files
    for existing_file in Path(video_server_dir).glob("*.mp4"):
        try:
            existing_file.unlink()
            print(f"Deleted existing file: {existing_file}")
        except Exception as e:
            print(f"Error deleting file {existing_file}: {e}")

    # Generate a unique session ID
    session_id = str(uuid.uuid4())

    # Store initial status
    job_status[session_id] = {
        "status": "processing",
        "message": "Video generation started",
        "created_at": time.time()
    }

    # Start processing in a separate thread
    def process_job():
        try:
            result = process_video_request(prompt, session_id)
            job_status[session_id] = result
        except Exception as e:
            job_status[session_id] = {
                "status": "error",
                "message": f"Unexpected error: {str(e)}"
            }
            print(f"Error in job {session_id}: {e}")
            traceback.print_exc()

    thread = threading.Thread(target=process_job)
    thread.daemon = True
    thread.start()

    return jsonify({
        "status": "accepted",
        "message": "Video generation job started",
        "job_id": session_id
    })


@app.route('/job-status/<job_id>', methods=['GET'])
def check_job_status(job_id):
    if job_id not in job_status:
        return jsonify({"status": "error", "message": "Job not found"}), 404

    return jsonify(job_status[job_id])


def main():
    try:
        # Ensure video_server directory exists
        video_server_dir = "video_server"
        Path(video_server_dir).mkdir(parents=True, exist_ok=True)

        print("Starting API server on port 5555")
        app.run(host='0.0.0.0', port=5555, debug=False, threaded=True)
    except Exception as e:
        print(f"Unexpected error in main function: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()
