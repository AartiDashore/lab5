"""LLM client module supporting Ollama and OpenAI-compatible APIs.
@author: Aarti Dashore, Sebastian Silva Arcos
Seattle University, ARIN 5360
@see: https://catalog.seattleu.edu/preview_course_nopop.php?catoid=55&coid
=190380
@version: 4.0.0+w26
"""

from typing import Optional

import httpx


class LLMClient:
    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "qwen2.5:3b",
        api_key: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key or "ollama"
        self.timeout = timeout

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 500,
    ) -> str:
        """Generate a response from the LLM given a prompt.

        Args:
            prompt: The user prompt to send.
            system_prompt: Optional system-level instructions.
            temperature: Sampling temperature (0.0 - 1.0).
            max_tokens: Maximum number of tokens in the response.

        Returns:
            The generated text response.

        Raises:
            RuntimeError: If the request fails or the response is malformed.
        """
        messages = []

        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        url = f"{self.base_url}/v1/chat/completions"

        try:
            response = httpx.post(
                url,
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
        except httpx.TimeoutException:
            raise RuntimeError(f"Request to LLM timed out after {self.timeout} seconds.")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(
                f"LLM request failed with status {e.response.status_code}: {e.response.text}"
            )
        except httpx.RequestError as e:
            raise RuntimeError(f"LLM request error: {e}")

        try:
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise RuntimeError(f"Unexpected response format from LLM: {e}\n{response.text}")

    def is_available(self) -> bool:
        """Check whether the LLM endpoint is reachable.

        Returns:
            True if the server responds to a GET on /v1/models, False otherwise.
        """
        url = f"{self.base_url}/v1/models"
        try:
            response = httpx.get(url, timeout=self.timeout)
            return response.status_code == 200
        except (httpx.RequestError, httpx.TimeoutException):
            return False
