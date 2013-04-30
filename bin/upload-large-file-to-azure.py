#! /usr/bin/env python

import sys, os
import base64

from azure.storage import *

blob_service = BlobService('goldrush',
                           '0LkjUUtQeAzaOccb5rkQbTT2sql8YrldYYdO4RhKnT4OTNfK+diveKbuDvqmxz0poyB9m2VpafBQLySvsaXNOA==')
blob_service.create_container('downloads')

chunk_size = 4 * 1024 * 1024

def upload(blob_service, container_name, blob_name, file_path):
    blob_service.create_container(container_name, None, None, False)
    blob_service.put_blob(container_name, blob_name, '', 'BlockBlob')

    block_ids = []
    index = 0
    with open(file_path, 'rb') as f:
        while True:
            data = f.read(chunk_size)
            if data:
                length = len(data)
                block_id = base64.b64encode(str(index))
                blob_service.put_block(container_name, blob_name, data, block_id)
                block_ids.append(block_id)
                index += 1
            else:
                break

    blob_service.put_block_list(container_name, blob_name, block_ids)
    print "{ \"success\": true }"

upload(blob_service, sys.argv[1], sys.argv[2], sys.argv[3])