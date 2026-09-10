import pytest


@pytest.fixture
def tmp(tmp_path):
    return tmp_path
