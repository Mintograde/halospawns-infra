"""Bootstrap handler for the native maps processor Lambda shell.

The real implementation is deployed from the halospawns-maps release ZIP.
"""


def handler(event, context):
    raise RuntimeError(
        "Placeholder maps processor package is installed. "
        "Publish a halospawns-maps Lambda ZIP before invoking this function."
    )
