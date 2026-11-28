import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app, mock_delay
from backend.app.mock import MockCatalog


@pytest.fixture
def catalog():
    return MockCatalog()


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, mock=True, data_dir=tmp_path)


@pytest.fixture
def client(settings):
    app = create_app(settings)

    async def no_delay():
        pass

    app.dependency_overrides[mock_delay] = no_delay
    with TestClient(app) as session:
        yield session

