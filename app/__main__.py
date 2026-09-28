import threading
import webbrowser
import uvicorn

HOST = "127.0.0.1"
PORT = 8000


def main() -> None:
    threading.Timer(1.5, webbrowser.open, args=[f"http://{HOST}:{PORT}"]).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT)


if __name__ == "__main__":
    main()
