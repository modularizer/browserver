from plat import serve_client_side_server

class HelloApi:
    async def greet(self, name: str) -> dict:
        """Say hello to someone by name."""
        return {"message": f"Hello, {name}!"}

serve_client_side_server("py-hello", [HelloApi])
