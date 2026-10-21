import re

import customeriq


def test_package_imports_with_version() -> None:
    assert re.fullmatch(r"\d+\.\d+\.\d+", customeriq.__version__)


def test_core_dependencies_import() -> None:
    import numpy as np
    import pandas as pd
    import pandera
    import sklearn

    frame = pd.DataFrame({"x": np.arange(3)})
    assert int(frame["x"].sum()) == 3
    assert sklearn.__version__
    assert pandera.__version__
