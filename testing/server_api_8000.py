import requests
import argparse
import sys
import os
import time
import json


def test_api(url, message, verbose=False, raw=False):
    """
    Test the API with a message and display the response in real-time.

    Args:
        url: API endpoint URL
        message: Message to send to the API
        verbose: Whether to print verbose logging info
        raw: Whether to print raw response chunks
    """
    print(f"\n=== API Test: {url} ===")
    print(f"Message: {message}")
    print("Response:")
    print("-" * 60)

    headers = {
        "Content-Type": "application/json",
    }

    data = {
        "message": message
    }

    if verbose:
        print(f"Request headers: {headers}")
        print(f"Request body: {json.dumps(data)}")

    # Use a session for better connection management
    session = requests.Session()

    try:
        # Use stream=True to get chunks as they arrive
        response = session.post(url, headers=headers, json=data, stream=True)

        if response.status_code != 200:
            print(f"Error: Received status code {response.status_code}")
            print(response.text)
            return

        # For verbose mode, print response headers
        if verbose:
            print(f"Response status: {response.status_code}")
            print(f"Response headers: {dict(response.headers)}")
            print("Starting stream processing...")

        # Process the streaming response
        full_response = ""
        chunk_count = 0

        for chunk in response.iter_lines():
            if chunk:
                chunk_count += 1
                chunk_text = chunk.decode('utf-8')

                # Print raw chunk if requested
                if raw:
                    print(f"\n--- Raw Chunk #{chunk_count} ---")
                    print(repr(chunk_text))

                # Process SSE format - lines starting with "data: "
                if chunk_text.startswith('data: '):
                    # Extract the content - remove "data: " prefix
                    content = chunk_text[6:]

                    if content == "[DONE]":
                        if verbose:
                            print("\n[Stream complete]")
                        break

                    if content.startswith("Error:"):
                        print(f"\nError: {content}")
                        break

                    # Print the content and accumulate
                    print(content, end="", flush=True)
                    full_response += content
                else:
                    if verbose:
                        print(f"\nIgnoring non-data chunk: {chunk_text}")

        print("\n" + "-" * 60)
        if verbose:
            print(f"Total chunks: {chunk_count}")
            print(f"Final response length: {len(full_response)} characters")

        return full_response

    except Exception as e:
        print(f"\nError during API test: {str(e)}")
        return None


def main():
    parser = argparse.ArgumentParser(description="Test the Chatbot API with streaming")
    parser.add_argument("--url", default="http://localhost:8000/api/chat",
                        help="URL for the API endpoint")
    parser.add_argument("--message",
                        default="TELL ME ABOUT KANYE. ALways answer in markdown please",
                        help="Message to send to the API")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Print verbose debug information")
    parser.add_argument("--raw", "-r", action="store_true",
                        help="Print raw response chunks")
    parser.add_argument("--markdown", "-m", action="store_true",
                        help="Request a markdown-heavy response")
    parser.add_argument("--spaces", "-s", action="store_true",
                        help="Test space preservation")

    args = parser.parse_args()

    # Prepare test message
    if args.markdown:
        message = """Tell me about Genghis Khan
"""
    elif args.spaces:
        message = "Tell me about Genghis Khan"
    else:
        message = args.message

    # Run the test
    test_api(args.url, message, args.verbose, args.raw)


if __name__ == "__main__":
    main()
