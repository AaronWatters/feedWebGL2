
"""
Local vendor Javascript files.
"""

from jp_proxy_widget import js_context
import os

my_dir = os.path.dirname(__file__)

def vendor_path(filename, local=False):
    return js_context.get_file_path(filename, my_dir=my_dir, local=local)
