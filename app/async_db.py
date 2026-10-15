import asyncio
from functools import partial


async def run_db(function, *args, **kwargs):
    """Ejecuta MySQL fuera del loop y no abandona una transacción en curso.

    Si se cancela el coroutine, mantiene el lock del llamador hasta que el
    worker termine. Una llamada MySQL ya enviada no se puede cancelar.
    """
    task = asyncio.create_task(asyncio.to_thread(partial(function, *args, **kwargs)))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            await task
        finally:
            raise
