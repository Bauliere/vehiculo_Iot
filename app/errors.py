class ApiError(Exception):
    """Error de dominio seguro para mostrar por HTTP o WebSocket."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)
