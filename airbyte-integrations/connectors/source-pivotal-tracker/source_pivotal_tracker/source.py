#
# Copyright (c) 2022 Airbyte, Inc., all rights reserved.
#


from abc import ABC, abstractmethod
from typing import Any, Iterable, List, Mapping, MutableMapping, Optional, Tuple

import requests
import logging
from airbyte_cdk.models import SyncMode
from airbyte_cdk.sources import AbstractSource
from airbyte_cdk.sources.streams import Stream
from airbyte_cdk.sources.streams.core import IncrementalMixin
from airbyte_cdk.sources.streams.http import HttpStream
from airbyte_cdk.sources.streams.http.auth import HttpAuthenticator

logger = logging.getLogger("airbyte")

class PivotalTrackerStream(HttpStream, ABC):

    url_base = "https://www.pivotaltracker.com/services/v5/"
    primary_key = "id"

    def next_page_token(self, response: requests.Response) -> Optional[Mapping[str, Any]]:

        headers = response.headers
        if "X-Tracker-Pagination-Total" not in headers:
            return None  # not paginating

        page_size = int(headers["X-Tracker-Pagination-Limit"])
        records_returned = int(headers["X-Tracker-Pagination-Returned"])
        current_offset = int(headers["X-Tracker-Pagination-Offset"])

        if records_returned < page_size:
            return None  # no more

        return {"offset": current_offset + page_size}

    def request_params(
        self, stream_state: Mapping[str, Any], stream_slice: Mapping[str, any] = None, next_page_token: Mapping[str, Any] = None
    ) -> MutableMapping[str, Any]:
        params: MutableMapping[str, Any] = {}
        if next_page_token:
            params["offset"] = next_page_token["offset"]
        return params

    def parse_response(self, response: requests.Response, **kwargs) -> Iterable[Mapping]:
        # print(response.json())
        for record in response.json():  # everything is in a list
            yield record


class Projects(PivotalTrackerStream):
    def path(
        self, stream_state: Mapping[str, Any] = None, stream_slice: Mapping[str, Any] = None, next_page_token: Mapping[str, Any] = None
    ) -> str:
        return "projects"


class Project(PivotalTrackerStream):
    def __init__(self, project_id: str, **kwargs):
        super().__init__(**kwargs)
        self.project_id = project_id

    def path(self, stream_state: Mapping[str, Any] = None, stream_slice: Mapping[str, Any] = None, next_page_token: Mapping[str, Any] = None) -> str:
        return f"projects/{self.project_id}"


class ProjectBasedStream(PivotalTrackerStream):
    @property
    @abstractmethod
    def subpath(self) -> str:
        """
        Within the project. For example, "stories" producing:
        https://www.pivotaltracker.com/services/v5/projects/{project_id}/stories
        """

    def __init__(self, project_ids: List[str], **kwargs):
        super().__init__(**kwargs)
        self.project_ids = project_ids

    def path(self, stream_slice: Mapping[str, Any] = None, **kwargs) -> str:
        return f"projects/{stream_slice['project_id']}/{self.subpath}"

    def stream_slices(self, stream_state: Mapping[str, Any] = None, **kwargs) -> Iterable[Optional[Mapping[str, any]]]:
        for project_id in self.project_ids:
            yield {"project_id": project_id}


class IncrementalPivotalStream(ProjectBasedStream, IncrementalMixin):
    state_checkpoint_interval = 100
    cursor_filter = "updated_after"

    def __init__(self, project_ids: List[str], **kwargs):
        super().__init__(project_ids=project_ids, **kwargs)
        self._cursor_value = ""

    @property
    def cursor_field(self) -> str:
        return "updated_at"

    @property
    def state(self):
        return {self.cursor_field: self._cursor_value} if self._cursor_value else {}

    @state.setter
    def state(self, value):
        self._cursor_value = value.get(self.cursor_field, "1970-01-01T00:00:00")

    def request_params(
        self, stream_state: Mapping[str, Any], stream_slice: Mapping[str, Any] = None, next_page_token: Mapping[str, Any] = None
    ) -> MutableMapping[str, Any]:
        params = super().request_params(stream_state=stream_state, stream_slice=stream_slice, next_page_token=next_page_token)
        params[self.cursor_filter] = stream_state.get(self.cursor_field)
        return params

    def read_records(
        self,
        sync_mode: SyncMode,
        cursor_field: List[str] = None,
        stream_slice: Mapping[str, Any] = None,
        stream_state: Mapping[str, Any] = None,
    ) -> Iterable[Mapping[str, Any]]:
        for record in super().read_records(
            sync_mode=sync_mode, cursor_field=cursor_field, stream_slice=stream_slice, stream_state=stream_state
        ):
            yield record
            self._cursor_value = max(record[self.cursor_field], self._cursor_value)


class Stories(IncrementalPivotalStream):
    subpath = "stories"


class ProjectMemberships(ProjectBasedStream):
    subpath = "memberships"


class Labels(ProjectBasedStream):
    subpath = "labels"


class Releases(ProjectBasedStream):
    subpath = "releases"


class Epics(ProjectBasedStream):
    subpath = "epics"


class Activity(IncrementalPivotalStream):
    subpath = "activity"
    primary_key = "guid"
    cursor_filter = "occurred_after"

    @property
    def cursor_field(self) -> str:
        return "occurred_at"

    def parse_response(self, response: requests.Response, **kwargs) -> Iterable[Mapping]:
        for record in super().parse_response(response, **kwargs):
            if "project" in record:
                record["project_id"] = record["project"]["id"]
            yield record


# Custom token authenticator because no "Bearer"
class PivotalAuthenticator(HttpAuthenticator):
    def __init__(self, token: str):
        self._token = token

    def get_auth_header(self) -> Mapping[str, Any]:
        return {"X-TrackerToken": self._token}


# Source
class SourcePivotalTracker(AbstractSource):
    @staticmethod
    def _get_authenticator(config: Mapping[str, Any]) -> HttpAuthenticator:
        token = config.get("api_token")
        return PivotalAuthenticator(token)

    @staticmethod
    def _check_project_availability(auth: HttpAuthenticator, project_id) -> bool:
        try:
            project = Project(authenticator=auth, project_id=project_id)
            next(project.read_records(SyncMode.full_refresh))
        except Exception as err:
            logger.error("Unable to fetch project info: %s", err)
            return False
        return True

    @staticmethod
    def _generate_project_ids(auth: HttpAuthenticator) -> List[str]:
        """
        Args:
            config (dict): Dict representing connector's config
        Returns:
            List[str]: List of project ids accessible by the api_token
        """

        projects = Projects(authenticator=auth)
        records = projects.read_records(SyncMode.full_refresh)
        project_ids: List[str] = []
        for record in records:
            project_id = record["id"]
            if SourcePivotalTracker._check_project_availability(auth, project_id):
                project_ids.append(project_id)

        return project_ids

    def check_connection(self, logger, config) -> Tuple[bool, any]:
        auth = SourcePivotalTracker._get_authenticator(config)
        self._generate_project_ids(auth)
        return True, None

    def streams(self, config: Mapping[str, Any]) -> List[Stream]:
        auth = self._get_authenticator(config)
        project_ids = self._generate_project_ids(auth)
        project_args = {"project_ids": project_ids, "authenticator": auth}
        return [
            Projects(authenticator=auth),
            Stories(**project_args),
            ProjectMemberships(**project_args),
            Labels(**project_args),
            Releases(**project_args),
            Epics(**project_args),
            Activity(**project_args),
        ]
